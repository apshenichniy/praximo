import { createHash } from "node:crypto"
import { CoachOnboardingToken } from "@praximo/auth"
import {
  CoachBotHealthRepo,
  CoachBotProvisioningRepo,
  CoachOnboardingRepo,
  Database,
  WorkspaceRepo,
} from "@praximo/db"
import { TelegramId, WorkspaceId } from "@praximo/domain"
import {
  BotRegistry,
  CoachBotCredential,
  CoachBotRelease,
  ManagerBotSender,
} from "@praximo/telegram"
import { Bot, InlineKeyboard } from "grammy"
import type { Update, User, UserFromGetMe } from "grammy/types"
import { ConfigProvider, Effect, Layer, ManagedRuntime, Result } from "effect"
import { clientLanguage, type Copy, messages } from "./messages.ts"
import {
  coachMiniAppUrl,
  constantTimeEqual,
  deliverCoachNotifications,
  type ManagedBotOutcome,
  offerBotCreation,
  prepareOnboarding,
  prepareRelink,
  provisionManagedBot,
} from "./provisioning.ts"
import { sweepCoachBotHealth } from "./coach-bot-health.ts"
import * as BotRegistryLive from "./bot-registry.ts"
import {
  authenticateProof,
  botFatherToken,
  completeOwnershipProof,
  ingestBotFatherToken,
} from "./token-fallback.ts"
import { refusalFor, refusalStatus, UndecidedRefusalStatus } from "./coach-webhook-refusal.ts"
import * as CoachBotReleaseLive from "./coach-bot-release.ts"

export interface Env {
  readonly DATABASE_URL: string
  readonly MANAGER_BOT_TOKEN: string
  readonly MANAGER_BOT_USERNAME: string
  readonly MANAGER_BOT_WEBHOOK_SECRET: string
  readonly COACH_BOT_CREDENTIAL_KEY: string
  readonly DEFAULT_COACH_BOT_AVATAR_R2_KEY: string
  readonly COACH_MINI_APP_URL: string
  /**
   * This Worker's own public origin — the value `manager-bot:set-webhook`
   * installs on the manager bot, bound here because the health sweep runs on a
   * cron and a repair re-arms the coach bot's webhook (#55). There is no request
   * to read an origin off at that point. Optional: a stage that never set it
   * still repairs credentials, it just leaves webhooks as Telegram has them.
   */
  readonly MANAGER_BOT_WEBHOOK_URL?: string
  readonly UPLOADS: R2Bucket
}

const DbLive = Layer.mergeAll(
  WorkspaceRepo.layer,
  CoachBotProvisioningRepo.layer,
  CoachBotHealthRepo.layer,
  CoachOnboardingRepo.layer,
).pipe(Layer.provide(Database.layer))
const CoachBotDataLive = Layer.mergeAll(DbLive, CoachBotCredential.layer)
const appLive = (env: Env) =>
  Layer.mergeAll(
    Layer.provideMerge(
      // The registry's live layer is the one thing here that needs the bindings
      // themselves rather than only the config they carry: a repair reads the
      // stage's avatar out of R2 (#55).
      Layer.mergeAll(CoachBotReleaseLive.layer, BotRegistryLive.layer(env)),
      CoachBotDataLive,
    ),
    ManagerBotSender.layer,
    CoachOnboardingToken.layer,
  )

const runtimeFromEnv = (env: Env) =>
  ManagedRuntime.make(
    Layer.provide(appLive(env), ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
  )

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

/**
 * The copy for a failure that never reached a workspace row, so the coach's own
 * language is unknown and the sender's Telegram client language is all there is.
 */
const errorText = (copy: Copy, tag: string, reason?: string): string => {
  if (
    tag === "CoachOnboardingToken.InvalidToken" ||
    tag === "CoachOnboardingRepo.InviteCodeUnresolved"
  ) {
    return copy.linkInvalid
  }
  if (reason === "expired" || reason === "cancelled") {
    // A cancelled invite reads as expired on purpose: the coach only needs to
    // know the link is dead and where a fresh one comes from, not that an
    // administrator reset it.
    return copy.linkExpired
  }
  if (reason === "used" || reason === "claimed") {
    return copy.linkUsed
  }
  return copy.setupUnavailable
}

/**
 * The reply to a pasted credential, once it is no longer a Telegram message.
 * Only an identity with no attempt at all is told to open its link first; every
 * other refusal is about the invitation, and says so.
 */
const ingestionText = (copy: Copy, tag: string, reason?: string): string => {
  if (tag === "BotWorker.TokenIngestionFailed") {
    return reason === "bot-taken" ? copy.tokenBotTaken : copy.tokenInvalid
  }
  if (tag === "CoachBotProvisioningRepo.ProvisioningUnavailable") {
    return reason === "not-found" ? copy.tokenNoActiveSetup : errorText(copy, tag, reason)
  }
  return copy.tokenSetupFailed
}

/**
 * Telegram permits deleting a message in a private chat for 48 hours, but not
 * every failure is a permission one. When the credential is still sitting in the
 * chat the coach has to be told, whatever else the reply says.
 */
const withDeletionNotice = (text: string, deleted: boolean, copy: Copy): string =>
  deleted ? text : `${text}\n\n${copy.tokenNotDeleted}`

const makeManagerBot = (
  env: Env,
  telegramFetch: typeof globalThis.fetch,
  webhookOrigin: string,
): Bot => {
  const bot = new Bot(env.MANAGER_BOT_TOKEN, { client: { fetch: telegramFetch } })

  bot.command("start", async (ctx) => {
    const language = clientLanguage(ctx.from?.language_code)
    if (ctx.from === undefined) {
      await ctx.reply(messages(language).openLinkFirst)
      return
    }
    const parameter = typeof ctx.match === "string" ? ctx.match : ""
    // Recovery is entered here, and by two doors (#55). The banner in the coach
    // Mini App carries the reserved payload; a bare `/start` is the door for a
    // coach who simply came back to the chat, and until now answered them with
    // advice to open a link they cannot have. Both resolve to the same reopen,
    // which does nothing at all for an identity with no broken bot — so a
    // stranger's `/start` still falls through to the same old answer.
    if (parameter.length === 0 || parameter === CoachOnboardingToken.RelinkStartParameter) {
      const relink = await getRuntime(env).runPromise(
        prepareRelink(ctx.from.id).pipe(Effect.orElseSucceed(() => undefined)),
      )
      if (relink === undefined) {
        await ctx.reply(messages(language).openLinkFirst)
        return
      }
      await getRuntime(env).runPromise(offerBotCreation(env, relink, "relink", telegramFetch))
      return
    }
    // The claim seeds the coach's language from the sender's own Telegram
    // client (#130), so the copy below — and every coach-facing message after
    // it — is already in it.
    const result = await getRuntime(env).runPromise(
      prepareOnboarding(parameter, ctx.from.id, language).pipe(Effect.result),
    )
    if (result._tag === "Failure") {
      const failure = result.failure as { readonly _tag?: string; readonly reason?: string }
      await ctx.reply(errorText(messages(language), failure._tag ?? "unknown", failure.reason))
      return
    }
    const setup = result.success
    const copy = messages(setup.coachLanguage)
    if (setup.status !== "requested") {
      await ctx.reply(setup.status === "completed" ? copy.linkUsed : copy.setupInProgress)
      return
    }
    // The prompt's whole lifecycle — disarm the previous button, send the new
    // one, record it — is one operation, because the invariant it holds spans all
    // three (#134).
    await getRuntime(env).runPromise(offerBotCreation(env, setup, "invitation", telegramFetch))
  })

  /**
   * The BotFather fallback (#95). Registered after `/start` so a command update
   * never reaches it, and gated on a private chat: a full-control credential is
   * only ever accepted from the coach's own conversation with the manager bot.
   */
  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private" || ctx.from === undefined) return
    const token = botFatherToken(ctx.message.text)
    if (token === undefined) return
    // Before validation, before anything else: the credential stops being a
    // Telegram message. An invalid or refused token is just as exposed sitting
    // in the chat as a working one.
    const deleted = await ctx.deleteMessage().then(
      () => true,
      () => false,
    )
    const outcome = await getRuntime(env).runPromise(
      ingestBotFatherToken(
        TelegramId.make(String(ctx.from.id)),
        token,
        webhookOrigin,
        telegramFetch,
      ).pipe(Effect.result),
    )
    if (Result.isSuccess(outcome)) {
      const copy = messages(outcome.success.coachLanguage)
      await ctx.reply(
        withDeletionNotice(
          copy.proofPrompt(outcome.success.username, outcome.success.proofLink),
          deleted,
          copy,
        ),
      )
      return
    }
    const failure = outcome.failure as { readonly _tag?: string; readonly reason?: string }
    const copy = messages(clientLanguage(ctx.from.language_code))
    await ctx.reply(
      withDeletionNotice(
        ingestionText(copy, failure._tag ?? "unknown", failure.reason),
        deleted,
        copy,
      ),
    )
  })

  return bot
}

const managerBotFor = (
  env: Env,
  telegramFetch: typeof globalThis.fetch,
  webhookOrigin: string,
): Promise<Bot> => {
  if (managerBot !== undefined) return Promise.resolve(managerBot)
  managerBotInitialization ??= (async () => {
    const bot = makeManagerBot(env, telegramFetch, webhookOrigin)
    await bot.init()
    managerBot = bot
    return bot
  })().catch((cause: unknown) => {
    managerBotInitialization = undefined
    throw cause
  })
  return managerBotInitialization
}

/**
 * What the coach is told once a `managed_bot` update has settled, and the answer
 * Telegram gets for it.
 *
 * Every settled outcome is a 200 — `provisionManagedBot`'s failure channel is
 * the only thing worth redelivering — so this is where the two are kept apart:
 * a coach with no open attempt is finished with, not failed (#135).
 *
 * The language is the sender's Telegram client, not the workspace's: this update
 * carries a user and a bot and nothing else, and the second-bot case has no
 * provisioning row left to read a chosen language off.
 */
export const managedBotReply = async (
  outcome: ManagedBotOutcome,
  user: User,
  send: (chatId: number, text: string) => Promise<unknown>,
): Promise<Response> => {
  const copy = messages(clientLanguage(user.language_code))
  if (outcome._tag === "NoOpenAttempt") {
    // Best-effort: this update is already terminal, and a Telegram hiccup on a
    // courtesy message must not be the thing that reopens the retry loop.
    await send(user.id, copy.extraBotNotConnected(outcome.botUsername)).catch(() => undefined)
    return new Response(null, { status: 200 })
  }
  // Not best-effort, deliberately: the coach has to learn their bot is live, and
  // a redelivery re-runs the (idempotent) rotation and tells them then.
  await send(user.id, copy.botConnected(outcome.installation.username))
  return new Response(null, { status: 200 })
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
  const webhookOrigin = new URL(request.url).origin
  const bot = await managerBotFor(env, telegramFetch, webhookOrigin)
  if (update.managed_bot !== undefined) {
    const result = await getRuntime(env).runPromise(
      provisionManagedBot(
        env,
        update.managed_bot.user,
        update.managed_bot.bot,
        webhookOrigin,
        telegramFetch,
      ).pipe(Effect.result),
    )
    if (result._tag === "Failure") return new Response(null, { status: 500 })
    if (result.success._tag === "Connected") coachBots.delete(String(update.managed_bot.bot.id))
    return managedBotReply(result.success, update.managed_bot.user, (chatId, text) =>
      bot.api.sendMessage(chatId, text),
    )
  }
  await bot.handleUpdate(update)
  return new Response(null, { status: 200 })
}

/**
 * `undefined` means this bot has no installation yet — on its own route that is
 * not an error but the other state the route serves: a bot whose credential was
 * pasted and which is answering its ownership handshake (#95).
 */
const coachBotFor = async (
  env: Env,
  botId: string,
): Promise<{ readonly bot: Bot; readonly webhookSecretHash: string } | undefined> => {
  const installation = await getRuntime(env).runPromise(
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const credentials = yield* CoachBotCredential.Service
      const installed = yield* repo.findByBotId(botId)
      return { installed, token: yield* credentials.decrypt(installed.encryptedToken) }
    }).pipe(Effect.result),
  )
  if (Result.isFailure(installation)) {
    if (installation.failure._tag === "CoachBotProvisioningRepo.InstallationNotFound") {
      return undefined
    }
    throw installation.failure
  }
  let bot = coachBots.get(botId)
  if (bot === undefined) {
    bot = new Bot(installation.success.token, {
      botInfo: installation.success.installed.botInfo as UserFromGetMe,
    })
    // The bot instance outlives the update that built it, so the greeting reads
    // its language off whoever is actually typing rather than off construction.
    bot.command("start", (ctx) => {
      const copy = messages(clientLanguage(ctx.from?.language_code))
      return ctx.reply(copy.botReady, {
        reply_markup: new InlineKeyboard().webApp(
          copy.openButton,
          coachMiniAppUrl(env.COACH_MINI_APP_URL, botId),
        ),
      })
    })
    coachBots.set(botId, bot)
  }
  return { bot, webhookSecretHash: installation.success.installed.webhookSecretHash }
}

const handleCoachWebhook = async (
  request: Request,
  env: Env,
  botId: string,
  telegramFetch: typeof globalThis.fetch,
): Promise<Response> => {
  const received = request.headers.get("x-telegram-bot-api-secret-token") ?? ""
  const installed = await coachBotFor(env, botId)
  if (installed === undefined) {
    return handleOwnershipProof(request, env, botId, received, telegramFetch)
  }
  const receivedHash = createHash("sha256").update(received).digest("hex")
  if (!constantTimeEqual(receivedHash, installed.webhookSecretHash)) {
    // An installed bot whose secret does not match is either a stale webhook
    // Telegram has not caught up to or somebody guessing at the route; logged
    // because a route that refuses in silence is what made #150 hard to see.
    await getRuntime(env).runPromise(
      Effect.logWarning(`coach bot ${botId}: update refused — webhook secret does not match`),
    )
    return new Response(null, { status: 401 })
  }
  await installed.bot.handleUpdate((await request.json()) as Update)
  return new Response(null, { status: 200 })
}

/**
 * The pasted bot's own route before it is installed. A failure answers 500 on
 * purpose: Telegram retries the handshake update, which is what makes a
 * half-configured attempt resumable without the coach doing anything.
 */
const handleOwnershipProof = async (
  request: Request,
  env: Env,
  botId: string,
  secretToken: string,
  telegramFetch: typeof globalThis.fetch,
): Promise<Response> => {
  const candidate = await getRuntime(env).runPromise(
    authenticateProof(botId, secretToken).pipe(
      Effect.tapError((failure) =>
        Effect.logWarning(
          `coach bot ${botId}: could not read its parked candidate, answering 500 — ${failure._tag}`,
        ),
      ),
      Effect.result,
    ),
  )
  if (Result.isFailure(candidate)) return new Response(null, { status: 500 })
  // Nothing parked, or the wrong secret: the body is never even read. Decided
  // after the handshake has had its chance, so a redelivered proof update can
  // still resume a half-configured attempt of its own.
  if (candidate.success === undefined) {
    const refusal = await getRuntime(env).runPromise(
      refusalFor(botId).pipe(
        Effect.map(refusalStatus),
        Effect.orElseSucceed(() => UndecidedRefusalStatus),
      ),
    )
    return new Response(null, { status: refusal })
  }
  const outcome = await getRuntime(env).runPromise(
    completeOwnershipProof(env, {
      candidate: candidate.success,
      secretToken,
      update: (await request.json()) as Update,
      webhookOrigin: new URL(request.url).origin,
      telegramFetch,
    }).pipe(Effect.result),
  )
  if (Result.isFailure(outcome)) return new Response(null, { status: 500 })
  if (outcome.success._tag === "Activated") coachBots.delete(botId)
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
  if (match?.[1] !== undefined) return handleCoachWebhook(request, env, match[1], telegramFetch)
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

/**
 * The five-minute cron does two things, in this order and neither able to stop
 * the other (#55).
 *
 * The sweep runs first because what it discovers is what the delivery pass then
 * carries out of the same tick — a bot found dead is announced within seconds
 * rather than on the next one. Each half is isolated: a sweep that dies on a
 * Telegram outage must not take the notification queue down with it, and a
 * failing queue must not stop discovery.
 */
export const handleScheduled = async (env: Env): Promise<void> => {
  const tick = getRuntime(env)
  await tick.runPromise(
    sweepCoachBotHealth(env).pipe(
      Effect.tapError((failure) =>
        Effect.logWarning(`coach bot health sweep skipped this tick — ${failure.operation}`),
      ),
      Effect.ignore,
    ),
  )
  await tick.runPromise(deliverCoachNotifications())
}

export const handleCoachBotReleaseRpc = (
  env: Env,
  workspaceId: WorkspaceId,
): Promise<CoachBotRelease.Result> => getRuntime(env).runPromise(releaseCoachBot(workspaceId))
