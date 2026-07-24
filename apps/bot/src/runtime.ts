import { createHash, timingSafeEqual } from "node:crypto"
import { CoachOnboardingToken } from "@praximo/auth"
import { CoachBotProvisioningRepo, CoachOnboardingRepo, Database, WorkspaceRepo } from "@praximo/db"
import { TelegramId, WorkspaceId } from "@praximo/domain"
import {
  BotRegistry,
  CoachBotCredential,
  CoachBotRelease,
  ManagerBotSender,
} from "@praximo/telegram"
import { Bot, InlineKeyboard, Keyboard } from "grammy"
import type { User, UserFromGetMe } from "grammy/types"
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"
import {
  deliverProvisioningNotifications,
  managedBotSuggestions,
  prepareOnboarding,
  provisionManagedBot,
} from "./provisioning.ts"
import * as CoachBotReleaseLive from "./coach-bot-release.ts"

export interface Env {
  readonly DATABASE_URL: string
  readonly MANAGER_BOT_TOKEN: string
  readonly MANAGER_BOT_USERNAME: string
  readonly MANAGER_BOT_WEBHOOK_SECRET: string
  readonly COACH_BOT_CREDENTIAL_KEY: string
  readonly DEFAULT_COACH_BOT_AVATAR_R2_KEY: string
  readonly COACH_MINI_APP_URL: string
  readonly UPLOADS: R2Bucket
}

const DbLive = Layer.mergeAll(
  WorkspaceRepo.layer,
  CoachBotProvisioningRepo.layer,
  CoachOnboardingRepo.layer,
).pipe(Layer.provide(Database.layer))
const CoachBotDataLive = Layer.mergeAll(DbLive, CoachBotCredential.layer)
const CoachBotReleaseLayer = Layer.provideMerge(CoachBotReleaseLive.layer, CoachBotDataLive)
const AppLive = Layer.mergeAll(
  CoachBotReleaseLayer,
  BotRegistry.layer,
  ManagerBotSender.layer,
  CoachOnboardingToken.layer,
)

const runtimeFromEnv = (env: Env) =>
  ManagedRuntime.make(Layer.provide(AppLive, ConfigProvider.layer(ConfigProvider.fromUnknown(env))))

/** Exactly one runtime per Worker isolate (ADR 0002), built from `env` once. */
let runtime: ReturnType<typeof runtimeFromEnv> | undefined
let managerBot: Bot | undefined
let managerBotInitialization: Promise<Bot> | undefined
const coachBots = new Map<string, Bot>()

const getRuntime = (env: Env) => (runtime ??= runtimeFromEnv(env))

const health = Effect.gen(function* () {
  yield* WorkspaceRepo.Service
  yield* BotRegistry.Service
  yield* ManagerBotSender.Service
  yield* CoachBotProvisioningRepo.Service
  yield* CoachBotCredential.Service
  return { app: "bot", status: "ok" } as const
})

const constantTimeEqual = (received: string, expected: string): boolean => {
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

const errorText = (tag: string, reason?: string): string => {
  if (
    tag === "CoachOnboardingToken.InvalidToken" ||
    tag === "CoachOnboardingRepo.InviteCodeUnresolved"
  ) {
    return "This setup link is invalid. Ask your Praximo administrator for a fresh link."
  }
  if (reason === "expired" || reason === "cancelled") {
    // A cancelled invite reads as expired on purpose: the coach only needs to
    // know the link is dead and where a fresh one comes from, not that an
    // administrator reset it.
    return "This setup link has expired. Ask your Praximo administrator to reissue it."
  }
  if (reason === "used" || reason === "claimed") {
    return "This setup link has already been used."
  }
  return "Bot setup could not be started. Please try again or ask your administrator for help."
}

const makeManagerBot = (env: Env, telegramFetch: typeof globalThis.fetch): Bot => {
  const bot = new Bot(env.MANAGER_BOT_TOKEN, { client: { fetch: telegramFetch } })

  bot.command("start", async (ctx) => {
    if (ctx.from === undefined || typeof ctx.match !== "string" || ctx.match.length === 0) {
      await ctx.reply("Open the one-time Praximo setup link sent by your administrator.")
      return
    }
    const result = await getRuntime(env).runPromise(
      prepareOnboarding(ctx.match, ctx.from.id).pipe(Effect.result),
    )
    if (result._tag === "Failure") {
      const failure = result.failure as { readonly _tag?: string; readonly reason?: string }
      await ctx.reply(errorText(failure._tag ?? "unknown", failure.reason))
      return
    }
    const setup = result.success
    if (setup.status !== "requested") {
      await ctx.reply(
        setup.status === "completed"
          ? "This setup link has already been used."
          : "This bot setup is already in progress. Telegram will retry the saved configuration automatically.",
      )
      return
    }
    const suggestions = managedBotSuggestions(setup.workspace.name)
    const keyboard = new Keyboard()
      .requestManagedBot("Create coach bot", setup.keyboardRequestId, {
        suggested_name: suggestions.name,
        suggested_username: suggestions.username,
      })
      .resized()
      .oneTime()
    await ctx.reply(
      `Create the managed bot for “${setup.workspace.name}”. The invitation is claimed only after Telegram confirms the bot.`,
      { reply_markup: keyboard },
    )
  })

  return bot
}

const managerBotFor = (env: Env, telegramFetch: typeof globalThis.fetch): Promise<Bot> => {
  if (managerBot !== undefined) return Promise.resolve(managerBot)
  managerBotInitialization ??= (async () => {
    const bot = makeManagerBot(env, telegramFetch)
    await bot.init()
    managerBot = bot
    return bot
  })().catch((cause: unknown) => {
    managerBotInitialization = undefined
    throw cause
  })
  return managerBotInitialization
}

const handleManagerWebhook = async (
  request: Request,
  env: Env,
  telegramFetch: typeof globalThis.fetch,
): Promise<Response> => {
  const received = request.headers.get("x-telegram-bot-api-secret-token") ?? ""
  if (!constantTimeEqual(received, env.MANAGER_BOT_WEBHOOK_SECRET)) {
    return new Response(null, { status: 401 })
  }
  const update = (await request.json()) as {
    readonly update_id: number
    readonly managed_bot?: { readonly user: User; readonly bot: User }
  }
  // The webhook's public origin is the canonical endpoint installed on every
  // coach bot. Attach it to this dispatch without persisting another secret.
  const bot = await managerBotFor(env, telegramFetch)
  if (update.managed_bot !== undefined) {
    const result = await getRuntime(env).runPromise(
      provisionManagedBot(
        env,
        update.managed_bot.user,
        update.managed_bot.bot,
        new URL(request.url).origin,
      ).pipe(Effect.result),
    )
    if (result._tag === "Failure") return new Response(null, { status: 500 })
    coachBots.delete(String(update.managed_bot.bot.id))
    await bot.api.sendMessage(
      update.managed_bot.user.id,
      `Your coach bot @${result.success.username} is connected. Open it to continue.`,
    )
    return new Response(null, { status: 200 })
  }
  await bot.handleUpdate(update)
  return new Response(null, { status: 200 })
}

const coachBotFor = async (
  env: Env,
  botId: string,
): Promise<{ readonly bot: Bot; readonly webhookSecretHash: string }> => {
  const installation = await getRuntime(env).runPromise(
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const credentials = yield* CoachBotCredential.Service
      const installed = yield* repo.findByBotId(botId)
      return { installed, token: yield* credentials.decrypt(installed.encryptedToken) }
    }),
  )
  let bot = coachBots.get(botId)
  if (bot === undefined) {
    bot = new Bot(installation.token, {
      botInfo: installation.installed.botInfo as UserFromGetMe,
    })
    bot.command("start", (ctx) =>
      ctx.reply("Praximo is ready.", {
        reply_markup: new InlineKeyboard().webApp("Open", env.COACH_MINI_APP_URL),
      }),
    )
    coachBots.set(botId, bot)
  }
  return { bot, webhookSecretHash: installation.installed.webhookSecretHash }
}

const handleCoachWebhook = async (request: Request, env: Env, botId: string): Promise<Response> => {
  const installed = await coachBotFor(env, botId)
  const received = request.headers.get("x-telegram-bot-api-secret-token") ?? ""
  const receivedHash = createHash("sha256").update(received).digest("hex")
  if (!constantTimeEqual(receivedHash, installed.webhookSecretHash)) {
    return new Response(null, { status: 401 })
  }
  await installed.bot.handleUpdate((await request.json()) as { update_id: number })
  return new Response(null, { status: 200 })
}

export const sendManagerText = Effect.fn("BotWorker.sendManagerText")(function* (
  recipient: TelegramId,
  text: string,
) {
  const sender = yield* ManagerBotSender.Service
  return yield* sender.sendText(recipient, text).pipe(
    Effect.match({
      onFailure: (failure) =>
        ManagerBotSender.RpcResult.cases.Failed.make({
          recipient: failure.recipient,
          category: failure.category,
        }),
      onSuccess: () => ManagerBotSender.RpcResult.cases.Sent.make({}),
    }),
  )
})

export const prepareManagerInlineInvite = Effect.fn("BotWorker.prepareManagerInlineInvite")(
  function* (recipient: TelegramId, invite: ManagerBotSender.InlineInvite) {
    const sender = yield* ManagerBotSender.Service
    return yield* sender.prepareInlineInvite(recipient, invite).pipe(
      Effect.match({
        onFailure: (failure) =>
          ManagerBotSender.PrepareRpcResult.cases.Failed.make({
            recipient: failure.recipient,
            category: failure.category,
          }),
        onSuccess: (prepared) =>
          ManagerBotSender.PrepareRpcResult.cases.Prepared.make({ id: prepared.id }),
      }),
    )
  },
)

export const releaseCoachBot = Effect.fn("BotWorker.releaseCoachBot")(function* (
  workspaceId: WorkspaceId,
) {
  const release = yield* CoachBotRelease.Service
  return yield* release.release(workspaceId)
})

export const handleRequest = async (
  request: Request,
  env: Env,
  telegramFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<Response> => {
  const pathname = new URL(request.url).pathname
  if (pathname === "/health") return Response.json(await getRuntime(env).runPromise(health))
  if (request.method !== "POST") return new Response(null, { status: 404 })
  if (pathname === "/telegram/manager") return handleManagerWebhook(request, env, telegramFetch)
  const match = /^\/telegram\/coach\/([0-9]+)$/.exec(pathname)
  if (match?.[1] !== undefined) return handleCoachWebhook(request, env, match[1])
  return new Response(null, { status: 404 })
}

export const handleManagerTextRpc = (
  env: Env,
  recipient: TelegramId,
  text: string,
): Promise<ManagerBotSender.RpcResult> =>
  getRuntime(env).runPromise(sendManagerText(recipient, text))

export const handleManagerInlineInviteRpc = (
  env: Env,
  recipient: TelegramId,
  invite: ManagerBotSender.InlineInvite,
): Promise<ManagerBotSender.PrepareRpcResult> =>
  getRuntime(env).runPromise(prepareManagerInlineInvite(recipient, invite))

export const handleScheduled = (env: Env): Promise<void> =>
  getRuntime(env).runPromise(deliverProvisioningNotifications())

export const handleCoachBotReleaseRpc = (
  env: Env,
  workspaceId: WorkspaceId,
): Promise<CoachBotRelease.Result> => getRuntime(env).runPromise(releaseCoachBot(workspaceId))
