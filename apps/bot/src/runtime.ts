import { createHash } from "node:crypto"
import { CoachOnboardingToken } from "@praximo/auth"
import {
  AvatarRepo,
  ClientAcceptanceRepo,
  CoachBotHealthRepo,
  CoachBotProvisioningRepo,
  CoachOnboardingRepo,
  Database,
  WorkspaceRepo,
} from "@praximo/db"
import {
  narrowCoachLanguage,
  parseClientInviteStartParameter,
  TelegramId,
  WorkspaceId,
} from "@praximo/domain"
import { clientCopy } from "@praximo/i18n"
import { AvatarStore } from "@praximo/storage"
import {
  BotRegistry,
  CoachBotCredential,
  CoachBotRelease,
  ManagerBotSender,
} from "@praximo/telegram"
import { Bot, InlineKeyboard } from "grammy"
import type { Update, User, UserFromGetMe } from "grammy/types"
import { ConfigProvider, Effect, Layer, ManagedRuntime, Result } from "effect"
import {
  acceptInvitation,
  AcceptCallbackPrefix,
  type BotMessage,
  LanguageCallbackPrefix,
  openInvitation,
  parseCallback,
  showConsent,
} from "./client-acceptance.ts"
import { clientLanguage, type Copy, messages } from "./messages.ts"
import { CoachBotProvisioning } from "./coach-bot-provisioning.ts"
import {
  coachMiniAppUrl,
  constantTimeEqual,
  HaveBotCallbackPrefix,
  type ManagedBotOutcome,
  prepareOnboarding,
  prepareRelink,
} from "./provisioning.ts"
import * as BotRegistryLive from "./bot-registry.ts"
import { authenticateProof, botFatherToken } from "./token-fallback.ts"
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
   * The client app's own origin (#191). Separate from `COACH_MINI_APP_URL`
   * because the two surfaces are: the Mini App is where a coach lives, and this
   * is where somebody who is not on Telegram reads a privacy policy before
   * agreeing to anything. Bound from that Worker's `.url` in `alchemy.run.ts`.
   */
  readonly CLIENT_APP_URL: string
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
  ClientAcceptanceRepo.layer,
  AvatarRepo.layer,
).pipe(Layer.provide(Database.layer))
const CoachBotDataLive = Layer.mergeAll(DbLive, CoachBotCredential.layer)
const appLive = (env: Env, fetch: typeof globalThis.fetch) => {
  const registry = (
    fetch === globalThis.fetch
      ? BotRegistryLive.layer(env.UPLOADS)
      : BotRegistryLive.layerWithFetch(env.UPLOADS, fetch)
  ).pipe(Layer.provide(CoachBotDataLive))
  // The same bucket the provisioning runtime reads the bot's branding image out
  // of, as a separate service because it is a separate concern: one reads one
  // stage-wide object, the other writes one object per coach — and the writer is
  // the seam `apps/client` shares for the Google import (#59).
  const core = Layer.mergeAll(
    CoachBotDataLive,
    registry,
    ManagerBotSender.layer,
    AvatarStore.layer(env.UPLOADS),
  )
  const provisioning = (
    fetch === globalThis.fetch
      ? CoachBotProvisioning.layer(env.UPLOADS)
      : CoachBotProvisioning.testLayer(env.UPLOADS, fetch)
  ).pipe(Layer.provide(core))
  const release = (
    fetch === globalThis.fetch
      ? CoachBotReleaseLive.layer
      : CoachBotReleaseLive.layerWithFetch(fetch)
  ).pipe(Layer.provide(CoachBotDataLive))

  return Layer.mergeAll(core, provisioning, release, CoachOnboardingToken.layer)
}

const runtimeFromEnv = (env: Env, fetch: typeof globalThis.fetch) =>
  ManagedRuntime.make(
    Layer.provide(appLive(env, fetch), ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
  )

/** Exactly one runtime per Worker isolate (ADR 0002), built from `env` once. */
let runtime: ReturnType<typeof runtimeFromEnv> | undefined
let runtimeFetch: typeof globalThis.fetch | undefined
let managerBot: Bot | undefined
let managerBotInitialization: Promise<Bot> | undefined
const coachBots = new Map<string, Bot>()

const getRuntime = (
  env: Env,
  fetch: typeof globalThis.fetch = runtimeFetch ?? globalThis.fetch,
) => {
  if (runtime === undefined || runtimeFetch !== fetch) {
    runtime = runtimeFromEnv(env, fetch)
    runtimeFetch = fetch
    managerBot = undefined
    managerBotInitialization = undefined
    coachBots.clear()
  }
  return runtime
}

const health = Effect.gen(function* () {
  yield* WorkspaceRepo.Service
  yield* BotRegistry.Service
  yield* ManagerBotSender.Service
  yield* CoachBotProvisioning.Service
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

/**
 * Every coach-facing string in `messages.ts` is authored as HTML (#164), so
 * every send that carries one says so. The two notification strings are the
 * documented exception and never pass through here.
 */
const Html = { parse_mode: "HTML" } as const

/** `sendMessage`'s options bag, so `managedBotReply` can pass one through. */
type SendOptions = NonNullable<Parameters<Bot["api"]["sendMessage"]>[2]>

/**
 * One button per row: the client's steps are a sequence, and a row of two would
 * read as a choice between them (#164 — every action is a button, never a URL
 * in the body).
 */
interface MessageOptions {
  readonly parse_mode: "HTML"
  readonly reply_markup?: InlineKeyboard
}

const replyOptions = (message: BotMessage): MessageOptions => {
  if (message.buttons.length === 0) return Html
  const keyboard = new InlineKeyboard()
  for (const button of message.buttons) {
    if (button.url !== undefined) keyboard.url(button.text, button.url).row()
    else if (button.callbackData !== undefined)
      keyboard.text(button.text, button.callbackData).row()
  }
  return { ...Html, reply_markup: keyboard }
}

/**
 * The conversation is **one message, edited forward**: language, then consent,
 * then the confirmation, each replacing the last in place. The chat keeps one
 * artefact instead of five bubbles of a form, and no superseded button stays
 * tappable.
 *
 * A failed edit falls back to a reply. Telegram refuses an edit whose content
 * is unchanged and refuses one on a message too old to edit; in both cases the
 * client still has to see where they are.
 */
const editForward = async (
  ctx: {
    readonly editMessageText: (text: string, other?: MessageOptions) => Promise<unknown>
    readonly reply: (text: string, other?: MessageOptions) => Promise<unknown>
  },
  message: BotMessage,
): Promise<void> => {
  const options = replyOptions(message)
  await ctx.editMessageText(message.text, options).catch(async () => {
    await ctx.reply(message.text, options).catch(() => undefined)
  })
}

/** Whose assistant this bot is — the `/start` doors' one lookup. */
const coachOfBot = (botId: string) =>
  Effect.flatMap(ClientAcceptanceRepo.Service, (repo) => repo.findBotOwner(botId))

const makeManagerBot = (env: Env, webhookOrigin: string): Bot => {
  const bot = new Bot(env.MANAGER_BOT_TOKEN, {
    client: { fetch: runtimeFetch ?? globalThis.fetch },
  })

  bot.command("start", async (ctx) => {
    const language = clientLanguage(ctx.from?.language_code)
    if (ctx.from === undefined) {
      await ctx.reply(messages(language).openLinkFirst, Html)
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
        await ctx.reply(messages(language).openLinkFirst, Html)
        return
      }
      await getRuntime(env).runPromise(
        Effect.flatMap(CoachBotProvisioning.Service, (service) =>
          service.offerBotCreation(relink, "relink"),
        ),
      )
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
      await ctx.reply(
        errorText(messages(language), failure._tag ?? "unknown", failure.reason),
        Html,
      )
      return
    }
    const setup = result.success
    const copy = messages(setup.coachLanguage)
    if (setup.status !== "requested") {
      await ctx.reply(setup.status === "completed" ? copy.linkUsed : copy.setupInProgress, Html)
      return
    }
    // The prompt's whole lifecycle — disarm the previous button, send the new
    // one, record it — is one operation, because the invariant it holds spans all
    // three (#134).
    await getRuntime(env).runPromise(
      Effect.flatMap(CoachBotProvisioning.Service, (service) =>
        service.offerBotCreation(setup, "invitation"),
      ),
    )
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
      Effect.flatMap(CoachBotProvisioning.Service, (service) =>
        service.ingestBotFatherToken(TelegramId.make(String(ctx.from.id)), token, webhookOrigin),
      ).pipe(Effect.result),
    )
    if (Result.isSuccess(outcome)) {
      const copy = messages(outcome.success.coachLanguage)
      // The proof link is the button and nothing else (#164). In the body it was
      // forty-eight characters of base64 wrapped across four lines of a phone —
      // the single most alarming thing in the whole setup, at the exact moment
      // the coach is being asked to trust us with a credential.
      await ctx.reply(
        withDeletionNotice(copy.proofPrompt(outcome.success.username), deleted, copy),
        {
          ...Html,
          reply_markup: new InlineKeyboard().url(
            copy.proofButton(outcome.success.username),
            outcome.success.proofLink,
          ),
        },
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
      Html,
    )
  })

  /**
   * "I already have a bot" — the creation prompt's second button (#164).
   *
   * It answers and changes nothing, which is what lets it stay this simple: no
   * claim to check, no state to fence, and a stale tap on a disarmed prompt
   * costs the coach the same instructions it would have cost them live. The
   * language comes back inside our own callback data, narrowed again here
   * because a value that made a round trip is worth re-checking.
   */
  bot.callbackQuery(new RegExp(`^${HaveBotCallbackPrefix}`), async (ctx) => {
    const copy = messages(
      clientLanguage(ctx.callbackQuery.data.slice(HaveBotCallbackPrefix.length)),
    )
    await ctx.answerCallbackQuery()
    await ctx.reply(copy.haveBotInstructions, Html)
  })

  return bot
}

const managerBotFor = (env: Env, webhookOrigin: string): Promise<Bot> => {
  if (managerBot !== undefined) return Promise.resolve(managerBot)
  managerBotInitialization ??= (async () => {
    const bot = makeManagerBot(env, webhookOrigin)
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
  send: (chatId: number, text: string, other?: SendOptions) => Promise<unknown>,
): Promise<Response> => {
  const copy = messages(clientLanguage(user.language_code))
  if (outcome._tag === "NoOpenAttempt") {
    // Best-effort: this update is already terminal, and a Telegram hiccup on a
    // courtesy message must not be the thing that reopens the retry loop.
    await send(user.id, copy.extraBotNotConnected(outcome.botUsername), Html).catch(() => undefined)
    return new Response(null, { status: 200 })
  }
  // Not best-effort, deliberately: the coach has to learn their bot is live, and
  // a redelivery re-runs the (idempotent) rotation and tells them then.
  const username = outcome.installation.username
  // "Open it to continue" left the coach to go and find the bot; the button is
  // the continuing (#164).
  await send(user.id, copy.botConnected(username), {
    ...Html,
    reply_markup: new InlineKeyboard().url(
      copy.openBotButton(username),
      `https://t.me/${username}`,
    ),
  })
  return new Response(null, { status: 200 })
}

const handleManagerWebhook = async (request: Request, env: Env): Promise<Response> => {
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
  const bot = await managerBotFor(env, webhookOrigin)
  const managed = update.managed_bot
  if (managed !== undefined) {
    const result = await getRuntime(env).runPromise(
      Effect.flatMap(CoachBotProvisioning.Service, (service) =>
        service.provisionManagedBot(managed.user, managed.bot, webhookOrigin),
      ).pipe(Effect.result),
    )
    if (result._tag === "Failure") return new Response(null, { status: 500 })
    if (result.success._tag === "Connected") coachBots.delete(String(managed.bot.id))
    return managedBotReply(result.success, managed.user, (chatId, text, other) =>
      bot.api.sendMessage(chatId, text, other),
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
    /**
     * `/start` stops answering everybody the same way (#56). Three doors:
     *
     * - `/start inv_<token>` opens the acceptance conversation;
     * - a bare `/start` from the coach keeps the menu it has always had;
     * - a bare `/start` from anyone else is told whose assistant this is, and
     *   nothing more. A token from another coach's workspace resolves to
     *   nothing and lands here too, so neither answer discloses the other.
     */
    bot.command("start", async (ctx) => {
      const parameter = typeof ctx.match === "string" ? ctx.match : ""
      const sender = ctx.from
      if (sender === undefined) return

      const token = parseClientInviteStartParameter(parameter)
      if (token !== undefined) {
        const outcome = await getRuntime(env).runPromise(
          openInvitation({
            token,
            telegramBotId: botId,
            telegramUserId: String(sender.id),
            clientLanguageCode: sender.language_code,
          }).pipe(Effect.orElseSucceed(() => ({ _tag: "Unknown" }) as const)),
        )
        if (outcome._tag !== "Unknown") {
          await ctx.reply(outcome.message.text, replyOptions(outcome.message))
          return
        }
      }

      const owner = await getRuntime(env).runPromise(
        coachOfBot(botId).pipe(Effect.orElseSucceed(() => undefined)),
      )
      if (owner !== undefined && owner.coachTelegramId === String(sender.id)) {
        const copy = messages(owner.coachLanguage)
        await ctx.reply(copy.botReady, {
          ...Html,
          reply_markup: new InlineKeyboard().webApp(
            copy.openButton,
            coachMiniAppUrl(env.COACH_MINI_APP_URL, botId),
          ),
        })
        return
      }

      // A stranger — including whoever presented a code this workspace does not
      // own. No Mini App button: the app is the coach's, not theirs.
      const clientCopyFor = clientCopy(narrowCoachLanguage(sender.language_code))
      await ctx.reply(clientCopyFor.stranger(owner?.workspaceName ?? ""), Html)
    })

    /** Language chosen: the same message becomes the consent text. */
    bot.callbackQuery(new RegExp(`^${LanguageCallbackPrefix}`), async (ctx) => {
      const choice = parseCallback(LanguageCallbackPrefix, ctx.callbackQuery.data)
      const sender = ctx.from
      await ctx.answerCallbackQuery()
      if (choice === undefined) return
      const outcome = await getRuntime(env).runPromise(
        showConsent({
          token: choice.token,
          language: choice.language,
          telegramBotId: botId,
          telegramUserId: String(sender.id),
          clientAppUrl: env.CLIENT_APP_URL,
        }).pipe(Effect.orElseSucceed(() => ({ _tag: "Unknown" }) as const)),
      )
      if (outcome._tag === "Unknown") return
      await editForward(ctx, outcome.message)
    })

    /** Consent given: the same message becomes the confirmation. */
    bot.callbackQuery(new RegExp(`^${AcceptCallbackPrefix}`), async (ctx) => {
      const choice = parseCallback(AcceptCallbackPrefix, ctx.callbackQuery.data)
      const sender = ctx.from
      await ctx.answerCallbackQuery()
      if (choice === undefined) return
      const outcome = await getRuntime(env).runPromise(
        acceptInvitation({
          token: choice.token,
          language: choice.language,
          telegramBotId: botId,
          telegramUserId: String(sender.id),
          telegramName: [sender.first_name, sender.last_name].filter(Boolean).join(" "),
          telegramUsername: sender.username,
        }).pipe(Effect.orElseSucceed(() => ({ _tag: "Unknown" }) as const)),
      )
      if (outcome._tag === "Unknown") return
      await editForward(ctx, outcome.message)
    })

    coachBots.set(botId, bot)
  }
  return { bot, webhookSecretHash: installation.success.installed.webhookSecretHash }
}

const handleCoachWebhook = async (request: Request, env: Env, botId: string): Promise<Response> => {
  const received = request.headers.get("x-telegram-bot-api-secret-token") ?? ""
  const installed = await coachBotFor(env, botId)
  if (installed === undefined) {
    return handleOwnershipProof(request, env, botId, received)
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
  const authenticatedCandidate = candidate.success
  const update = (await request.json()) as Update
  const outcome = await getRuntime(env).runPromise(
    Effect.flatMap(CoachBotProvisioning.Service, (service) =>
      service.completeOwnershipProof({
        candidate: authenticatedCandidate,
        secretToken,
        update,
        webhookOrigin: new URL(request.url).origin,
      }),
    ).pipe(Effect.result),
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

/**
 * The coach's own bot authors the invitation card (#179).
 *
 * The whole operation is the registry's — resolve, decrypt, mint, repair a
 * refused credential and retry — so this is only the boundary: a failure becomes
 * a tagged answer rather than an exception a service binding would flatten into
 * "the Worker threw".
 */
export const prepareCoachInviteCard = Effect.fn("BotWorker.prepareCoachInviteCard")(function* (
  workspace: WorkspaceId,
  card: BotRegistry.InviteCard,
) {
  const registry = yield* BotRegistry.Service
  return yield* registry.prepareCard(workspace, card).pipe(
    Effect.match({
      onFailure: (failure) =>
        BotRegistry.PrepareCardRpcResult.cases.Failed.make({
          workspace: failure.workspace,
          reason: failure.reason,
        }),
      onSuccess: (prepared) =>
        BotRegistry.PrepareCardRpcResult.cases.Prepared.make({
          id: prepared.id,
          expiresAtMillis: prepared.expiresAt.getTime(),
        }),
    }),
  )
})

export const releaseCoachBot = Effect.fn("BotWorker.releaseCoachBot")(function* (
  workspaceId: WorkspaceId,
) {
  const release = yield* CoachBotRelease.Service
  return yield* release.release(workspaceId)
})

export const handleRequest = async (
  request: Request,
  env: Env,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<Response> => {
  const pathname = new URL(request.url).pathname
  const activeRuntime = getRuntime(env, fetch)
  if (pathname === "/health") return Response.json(await activeRuntime.runPromise(health))
  if (request.method !== "POST") return new Response(null, { status: 404 })
  if (pathname === "/telegram/manager") return handleManagerWebhook(request, env)
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
    Effect.flatMap(CoachBotProvisioning.Service, (service) => service.sweepCoachBotHealth()).pipe(
      Effect.tapError((failure) =>
        Effect.logWarning(`coach bot health sweep skipped this tick — ${failure.operation}`),
      ),
      Effect.ignore,
    ),
  )
  await tick.runPromise(
    Effect.flatMap(CoachBotProvisioning.Service, (service) => service.deliverCoachNotifications()),
  )
}

export const handleCoachBotReleaseRpc = (
  env: Env,
  workspaceId: WorkspaceId,
): Promise<CoachBotRelease.Result> => getRuntime(env).runPromise(releaseCoachBot(workspaceId))

export const handleCoachInviteCardRpc = (
  env: Env,
  workspace: WorkspaceId,
  card: BotRegistry.InviteCard,
): Promise<BotRegistry.PrepareCardRpcResult> =>
  getRuntime(env).runPromise(prepareCoachInviteCard(workspace, card))
