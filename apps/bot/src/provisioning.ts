import { timingSafeEqual } from "node:crypto"
import { CoachOnboardingToken } from "@praximo/auth"
import { CoachBotProvisioningRepo, CoachNotification, CoachOnboardingRepo } from "@praximo/db"
import { type CoachLanguage, TelegramId, type WorkspaceId } from "@praximo/domain"
import { CoachBotCredential, ManagerBotSender } from "@praximo/telegram"
import { Api, GrammyError, InlineKeyboard, InputFile } from "grammy"
import type { User } from "grammy/types"
import { Clock, Effect, Result, Schema } from "effect"
import { defaultBotDescription, defaultBotShortDescription } from "./default-branding.ts"
import { messages } from "./messages.ts"

export interface ProvisioningEnv {
  readonly MANAGER_BOT_TOKEN: string
  readonly DEFAULT_COACH_BOT_AVATAR_R2_KEY: string
  readonly COACH_MINI_APP_URL: string
  readonly UPLOADS: R2Bucket
}

export class TelegramSetupFailed extends Schema.TaggedErrorClass<TelegramSetupFailed>()(
  "BotWorker.TelegramSetupFailed",
  { operation: Schema.String },
) {}

/**
 * Telegram's shape for a bot username: 5–32 characters of `[A-Za-z0-9_]`,
 * opening with a letter, ending in `bot`.
 */
const UsernameMaxLength = 32
const UsernameEnding = "_bot"
/**
 * Four base-36 symbols — about 1.7 million tags. Not a uniqueness guarantee and
 * not a secret: enough that a plausible stem stops landing on a name somebody
 * registered years ago, while staying short enough to read in a URL.
 */
const TagLength = 4

/**
 * A short, stable tag for one workspace.
 *
 * FNV-1a over the id rather than a slice of it: the id is
 * `ws_{uuid-without-dashes}` in production but `ws_dev_fixture_ada` from the dev
 * seed, so no fixed offset carries the same amount of variety. Derived rather
 * than random because `/start` is a resume path that re-sends the prompt (#134)
 * — a coach who reopens their link must be offered the same username, not a new
 * one each time.
 */
const workspaceTag = (workspaceId: WorkspaceId): string => {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(workspaceId)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(TagLength, "0").slice(-TagLength)
}

/**
 * The bot username offered to a coach, pre-filled into the creation deep link
 * (#134) and editable by them in Telegram's own dialog.
 *
 * Two jobs at once. It has to *read* as the workspace's — so the name is folded
 * to ASCII and punctuation collapsed — and it has to be one Telegram will accept
 * and probably still has free, which the bare stem is not: `demo_bot` and
 * `coaching_bot` were registered long ago, and the namespace being collided with
 * is the whole of Telegram's, not ours (#147). Hence the tag.
 *
 * Every branch below keeps the result inside Telegram's shape by construction,
 * so there is no length guard or fallback at the end to be dead code: the head
 * always opens with a letter, the trim can never eat that letter, and the
 * budget is arithmetic rather than a truncation of the finished string.
 */
export const suggestedBotUsername = (workspaceName: string, workspaceId: WorkspaceId): string => {
  const stem = workspaceName
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^A-Za-z0-9]+/g, "_")
    // Leading separators only, and only because they decide the branch below: a
    // stem that opens with `_` is not a stem. Trailing ones are left to the strip
    // after the cut, which has to run there regardless — doing it twice would
    // just be a second expression that can never change an output.
    .replaceAll(/^_+/g, "")
    .toLowerCase()
  // A name with nothing ASCII left in it — every character was punctuation, or
  // it was written in a script the fold drops — gets the platform's own stem
  // rather than a bare `coach_`, which the tag then still makes theirs.
  // Stripping the leading separators is what makes this exhaustive: a stem is
  // either empty or opens with a letter or a digit, never with `_`.
  const usernameStem =
    stem.length === 0 ? "praximo_coach" : /^[a-z]/.test(stem) ? stem : `coach_${stem}`
  const tag = workspaceTag(workspaceId)
  // What is left for the name once the tag and the ending have taken their room,
  // including the `_` that joins them.
  const room = UsernameMaxLength - UsernameEnding.length - TagLength - 1
  // Stripped *after* the cut, the only place it can be done once and still hold:
  // a stem that truncates exactly on a `_` would otherwise meet the joining one
  // and read as `..__{tag}`.
  const head = usernameStem.slice(0, room).replace(/_+$/, "")
  return `${head}_${tag}${UsernameEnding}`
}

/**
 * Whose name the bot's description carries. The coach's own Telegram name is
 * the honest answer — the workspace label is the admin's private shorthand and
 * the coach never sees it — so the label is only the fallback.
 */
export const coachDisplayName = (user: User, workspaceName: string): string => {
  const telegramName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim()
  return telegramName.length === 0 ? workspaceName : telegramName
}

/**
 * Every Telegram call the provisioning paths make. The cause is dropped on
 * purpose: a grammY failure carries the request URL, and for a coach bot that
 * URL carries its token (ADR 0004).
 */
export const telegram = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: () => new TelegramSetupFailed({ operation }),
  })

export const webhookSecret = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

export const constantTimeEqual = (received: string, expected: string): boolean => {
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export const sha256 = (value: string) =>
  Effect.promise(() =>
    crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(value))
      .then((digest) =>
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      ),
  )

/**
 * The bot's starting avatar, read from R2: one image per stage, swapped by
 * upload rather than by deploy (#138).
 */
const loadAvatarObject = Effect.fn("BotWorker.loadAvatarObject")(function* (
  env: ProvisioningEnv,
  key: string,
) {
  const object = yield* Effect.tryPromise({
    try: () => env.UPLOADS.get(key),
    catch: () => new TelegramSetupFailed({ operation: "avatar.load" }),
  })
  if (object === null) return yield* new TelegramSetupFailed({ operation: "avatar.not-found" })
  return new Uint8Array(
    yield* Effect.tryPromise({
      try: () => object.arrayBuffer(),
      catch: () => new TelegramSetupFailed({ operation: "avatar.read" }),
    }),
  )
})

export interface CoachBotConfiguration {
  readonly env: ProvisioningEnv
  readonly token: string
  readonly botId: string
  readonly workspace: CoachBotProvisioningRepo.WorkspaceProfile
  readonly coachName: string
  /**
   * The webhook secret to hand back for the caller to arm once the installation
   * exists (#150) — supplied when one is already armed on this bot and recorded
   * against it. The BotFather fallback (#95) passes the secret it armed to
   * receive the ownership proof: rotating it mid-configuration would lock out
   * the very retry a partial failure depends on. Omitted, a fresh one is minted.
   */
  readonly secret?: string
  readonly telegramFetch?: typeof globalThis.fetch
}

/**
 * The label on every coach bot's in-chat menu button. Deliberately the same
 * English word Telegram puts on the chat-list Main Mini App button and the same
 * one the manager bot carries (`scripts/menu-button.ts`): a coach who enables
 * the Main Mini App themselves in @BotFather then has two entry points to one
 * app under one word, which is the BotFather pattern (ADR 0004 §Mini App entry
 * points, #86). Not translated for that reason — it names the platform
 * affordance, not our copy.
 */
export const CoachMenuButtonText = "Open"

export const apiFor = (token: string, telegramFetch?: typeof globalThis.fetch): Api =>
  new Api(token, telegramFetch === undefined ? undefined : { fetch: telegramFetch })

/**
 * The coach Mini App URL for one specific bot: the configured base plus
 * `?b=<telegramBotId>`.
 *
 * The parameter makes a launch self-identifying, which is what lets the app
 * verify the Ed25519 signature against a named bot *before* it touches the
 * database — no authorization decision is taken from an unverified key (ADR
 * 0006). It is untrusted on its own: the signature binds the bot id, so a
 * forged or borrowed value simply fails to verify.
 *
 * A base the URL parser rejects is handed back unchanged rather than throwing.
 * Every caller here is on a path where a connected bot already exists, and the
 * app still resolves such a launch by identity; `setCoachBotMenuButton` is where
 * an unusable value is refused outright — the first step of provisioning, so
 * before a bot is branded and before its coach is promised anything (#156).
 */
export const coachMiniAppUrl = (baseUrl: string, botId: string): string => {
  try {
    const url = new URL(baseUrl)
    url.searchParams.set("b", botId)
    return url.toString()
  } catch {
    return baseUrl
  }
}

export const configureCoachBot = Effect.fn("BotWorker.configureCoachBot")(function* (
  input: CoachBotConfiguration,
) {
  const { botId, coachName, env, token, workspace } = input
  const api = apiFor(token, input.telegramFetch)
  const botInfo = yield* telegram("getMe", () => api.getMe())
  // A workspace that still carries its own avatar key (from before manager-side
  // branding was removed, #108) keeps it; every other bot wears the stage's
  // platform image.
  const avatarKey = workspace.avatarR2Key ?? env.DEFAULT_COACH_BOT_AVATAR_R2_KEY
  const secret = input.secret ?? webhookSecret()

  // The whole photo step is best-effort, on purpose (#138). Nothing about the
  // picture may cost a coach their onboarding — not a stage that never uploaded
  // one, not an R2 hiccup, and not an object someone put there that Telegram
  // refuses. Since the object is no longer computed from the bot id, a bad one
  // would fail every retry identically and strand the coach; a bot without a
  // photo is recoverable by the coach in @BotFather, so that is the way to fail.
  // The warning names the operation and the key, which is what an operator needs
  // to point `bun run branding:avatar:set` at.
  const photo = yield* loadAvatarObject(env, avatarKey).pipe(
    Effect.flatMap((bytes) =>
      telegram("setMyProfilePhoto", () =>
        api.setMyProfilePhoto({ type: "static", photo: new InputFile(bytes, "avatar.jpg") }),
      ),
    ),
    Effect.result,
  )
  if (Result.isFailure(photo)) {
    yield* Effect.logWarning(
      `coach bot ${botId} provisioned without a profile photo: ${photo.failure.operation} on "${avatarKey}"`,
    )
  }
  yield* telegram("setMyDescription", () =>
    api.setMyDescription(workspace.description ?? defaultBotDescription(coachName)),
  )
  yield* telegram("setMyShortDescription", () =>
    api.setMyShortDescription(workspace.shortDescription ?? defaultBotShortDescription(coachName)),
  )
  return { secret, botInfo }
})

/**
 * Put the Mini App on the bot's in-chat menu button — **the first thing done to a
 * new bot, before the coach is told anything.**
 *
 * A Telegram client caches a bot's menu button when it opens the chat, and the
 * coach opens theirs by tapping **Start bot** the moment the bot exists — which is
 * the same moment the `managed_bot` update reaches us. Setting the button at the
 * end of configuration meant their client had already looked and cached its
 * absence: verified by `getChatMenuButton` returning the right `web_app` button
 * while the coach saw none, and by the button appearing as soon as they reopened
 * the chat (#156).
 *
 * This wins that race rather than removing it — their tap and our first call are
 * simultaneous. What makes that acceptable is that the greeting carries its own
 * inline **Open** button, so the coach is never without a way in, and the menu
 * button materialises on their next visit regardless.
 *
 * The Mini App URL is validated here because this is what consumes it, which also
 * means an unusable one fails before the coach has been promised anything.
 */
export const setCoachBotMenuButton = Effect.fn("BotWorker.setCoachBotMenuButton")(
  function* (input: {
    readonly token: string
    readonly botId: string
    readonly miniAppBaseUrl: string
    readonly telegramFetch?: typeof globalThis.fetch
  }) {
    const miniAppUrl = yield* Effect.try({
      try: () => {
        const url = new URL(input.miniAppBaseUrl)
        if (url.protocol !== "https:") throw new Error("Mini App URL must use HTTPS")
        return coachMiniAppUrl(url.toString(), input.botId)
      },
      catch: () => new TelegramSetupFailed({ operation: "miniAppUrl.validate" }),
    })
    const api = apiFor(input.token, input.telegramFetch)
    yield* telegram("setChatMenuButton", () =>
      api.setChatMenuButton({
        menu_button: { type: "web_app", text: CoachMenuButtonText, web_app: { url: miniAppUrl } },
      }),
    )
  },
)

/**
 * Point a coach bot at us. Its own step rather than part of configuration,
 * because **when it runs relative to the database write is a decision each
 * caller has to take, and the two callers take it differently** (#150).
 *
 * *A bot being connected for the first time arms last, after the activation
 * transaction.* A bot whose webhook is set starts delivering immediately, and
 * Telegram shows the coach their freshly created bot the moment it exists, so
 * their first `/start` used to arrive while the transaction had not committed —
 * into a route where `findByBotId` finds nothing and the handshake has nothing
 * parked. Arming last removes that window rather than papering over what happens
 * inside it: an update Telegram holds because no webhook is set is delivered once
 * one is, and by then the installation is there to serve it. The trade is that a
 * failure here leaves a *connected* workspace whose bot is deaf — repaired by the
 * redelivery of the `managed_bot` update, and it cannot cost the coach a greeting
 * they were never going to get from an unarmed bot anyway.
 *
 * *A bot being re-configured arms first, before the row is rewritten.* There the
 * installation already exists, so there is no window to close — and there is a
 * working bot to lose. Only the hash of a secret is ever stored, so a new hash
 * committed before Telegram accepts the new secret would leave a healthy bot
 * answering 401 to its own coach.
 *
 * The shared rule underneath both: **never let the stored hash and the secret
 * Telegram presents diverge in the direction that costs more.**
 */
export const armCoachBotWebhook = Effect.fn("BotWorker.armCoachBotWebhook")(function* (input: {
  readonly token: string
  readonly botId: string
  readonly secret: string
  readonly webhookOrigin: string
  /**
   * Discard whatever Telegram queued while the bot had no webhook. True only on
   * a first-time connection, where the one thing in that queue is the coach's own
   * `/start` from the **Start bot** button — which we answer ourselves, in place,
   * rather than let Telegram replay into a second greeting (#154). Left false on
   * the BotFather path, where a queued update may be the proof handshake itself.
   */
  readonly dropPendingUpdates?: boolean
  readonly telegramFetch?: typeof globalThis.fetch
}) {
  const api = apiFor(input.token, input.telegramFetch)
  yield* telegram("setWebhook", () =>
    api.setWebhook(`${input.webhookOrigin}/telegram/coach/${input.botId}`, {
      secret_token: input.secret,
      allowed_updates: ["message", "callback_query"],
      ...(input.dropPendingUpdates === true ? { drop_pending_updates: true } : {}),
    }),
  )
})

/**
 * The coach's own bot, talking to the coach while it is still being set up — and
 * then in place, once it is (#154).
 *
 * Telegram ends its creation dialog with a **Start bot** button, so the coach taps
 * it seconds before there is anything to answer with. They used to get silence,
 * conclude nothing had happened, and tap again. Two facts make this work without
 * waiting to hear from them: a bot may message a user who has started it, and
 * *only* such a user — so a send that succeeds proves they are sitting in the
 * chat, and one that fails with 403 proves they are not there to be told
 * anything. Either way it is best-effort, and neither can cost the coach their
 * onboarding.
 */
/**
 * Why the setup announcement did not land, to the only resolution that matters.
 *
 * `unopened` is Telegram refusing a message to a user who has not started the
 * bot, and it is the *expected* answer — a coach who has not tapped **Start bot**
 * has no chat for us to write in. Everything else is a send that should have
 * worked, and may even have arrived without us learning its message id.
 *
 * Classified the way `ManagerBotSender` classifies its own failures, and as
 * carefully: the category is all that escapes, never the cause, which can carry
 * the bot's token or the message body (ADR 0004).
 */
export const announcementFailure = (cause: unknown): "unopened" | "undelivered" =>
  cause instanceof GrammyError &&
  (cause.error_code === 403 || cause.description.toLocaleLowerCase().includes("chat not found"))
    ? "unopened"
    : "undelivered"

export const announceCoachBotSetup = Effect.fn("BotWorker.announceCoachBotSetup")(
  function* (input: {
    readonly token: string
    readonly chatId: TelegramId
    readonly language: CoachLanguage
    readonly telegramFetch?: typeof globalThis.fetch
  }) {
    const api = apiFor(input.token, input.telegramFetch)
    // Deliberately not `telegram()`, which drops the cause: this is the one place
    // that has to tell "the coach is not in the chat" from "the send did not
    // land", and only the Bot API error code says which.
    const sent = yield* Effect.tryPromise({
      try: () => api.sendMessage(input.chatId, messages(input.language).botSettingUp),
      catch: announcementFailure,
    }).pipe(Effect.result)
    if (Result.isSuccess(sent)) return sent.success.message_id
    if (sent.failure === "unopened") {
      // The ordinary case, and a useful signal rather than a fault: the coach has
      // not tapped **Start bot**, so there is nobody in the chat to tell.
      yield* Effect.logInfo(
        `coach bot ${input.chatId}: nothing to announce to — the coach has not opened it yet`,
      )
      return undefined
    }
    // Anything else is a send that should have landed, and may even have arrived
    // without us learning its id — in which case the greeting becomes its own
    // message rather than an edit of this one. A warning, not a shrug.
    yield* Effect.logWarning(
      `coach bot ${input.chatId}: setup announcement undelivered; the greeting will be a new message`,
    )
    return undefined
  },
)

/**
 * Turn that announcement into the greeting, or make the greeting from nothing.
 *
 * Edited rather than followed by a second message: the coach is looking at the
 * line that said it would take a few seconds, and the honest end of that sentence
 * is the same line saying it is done. When there was no announcement to edit —
 * they had not opened the bot — this is their first message instead.
 *
 * Best-effort throughout. The bot is connected the moment the activation
 * transaction commits, and a greeting Telegram refuses may not undo that.
 */
export const greetCoachOnBotReady = Effect.fn("BotWorker.greetCoachOnBotReady")(function* (input: {
  readonly token: string
  readonly chatId: TelegramId
  readonly language: CoachLanguage
  readonly botId: string
  readonly miniAppBaseUrl: string
  readonly announcementMessageId?: number
  readonly telegramFetch?: typeof globalThis.fetch
}) {
  const api = apiFor(input.token, input.telegramFetch)
  const copy = messages(input.language)
  const keyboard = new InlineKeyboard().webApp(
    copy.openButton,
    coachMiniAppUrl(input.miniAppBaseUrl, input.botId),
  )
  const announced = input.announcementMessageId
  const delivery =
    announced === undefined
      ? telegram("sendMessage", () =>
          api.sendMessage(input.chatId, copy.botReady, { reply_markup: keyboard }),
        ).pipe(Effect.asVoid)
      : telegram("editMessageText", () =>
          api.editMessageText(input.chatId, announced, copy.botReady, {
            reply_markup: keyboard,
          }),
        ).pipe(Effect.asVoid)
  yield* bestEffort(
    delivery,
    (operation) =>
      `coach bot ${input.botId} is connected but its coach was not greeted: ${operation}`,
  )
})

export const prepareOnboarding = Effect.fn("BotWorker.prepareOnboarding")(function* (
  parameter: string,
  telegramUserId: number,
) {
  const tokens = yield* CoachOnboardingToken.Service
  const onboarding = yield* CoachOnboardingRepo.Service
  const repo = yield* CoachBotProvisioningRepo.Service
  // The start param carries only the public code: reject junk by format, then
  // resolve it to an invite id the provisioning repo can advance.
  const code = yield* tokens.verify(parameter)
  const inviteId = yield* onboarding.resolveCode(code)
  return yield* repo.prepare(
    inviteId,
    TelegramId.make(String(telegramUserId)),
    new Date(yield* Clock.currentTimeMillis),
  )
})

/** What it takes to reach the coach's manager chat at all. */
export interface ManagerBotEnv {
  readonly MANAGER_BOT_TOKEN: string
}

/** …plus the name the creation deep link has to carry. */
export interface CreationPromptEnv extends ManagerBotEnv {
  readonly MANAGER_BOT_USERNAME: string
}

/**
 * A step whose failure must not cost the coach their onboarding: run it, and on
 * failure say what was lost instead of propagating it.
 *
 * Every step this wraps is one of the prompt's, and they share a reason. The
 * prompt is a courtesy on top of a fact — an invitation reserved, or a bot
 * connected — that is already true in the database, and no amount of Telegram
 * refusing to redraw a message may undo it. The operation name is what an
 * operator needs, so it is what the warning carries.
 */
const bestEffort = <A, E extends { readonly operation: string }, R>(
  step: Effect.Effect<A, E, R>,
  lost: (operation: string) => string,
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const outcome = yield* Effect.result(step)
    if (Result.isFailure(outcome)) yield* Effect.logWarning(lost(outcome.failure.operation))
  })

/**
 * Where the coach launches creation from: Telegram's own managed-bot dialog,
 * opened by deep link rather than by a `request_managed_bot` reply-keyboard
 * button.
 *
 * The button does not work on Telegram iOS — the client degrades the *whole*
 * keyboard into a share action, so even a plain button beside it stops
 * responding (#134). This link opens the same dialog on every client, drives the
 * same MTProto `bots.createBot`, and produces the same `managed_bot` update; it
 * rides an inline `url` button, the most basic inline type there is. Only the
 * username travels with it — the coach names the bot in the dialog.
 */
export const createBotLink = (managerBotUsername: string, suggestedUsername: string): string =>
  `https://t.me/newbot/${managerBotUsername}/${suggestedUsername}`

/**
 * Offer bot creation, holding the invariant that matters more than any one
 * message: **at most one live creation button exists in the coach's chat.**
 *
 * A link in a message is permanent and trivially tapped twice, where the
 * `oneTime()` keyboard button it replaces vanished after a tap — and `/start` is
 * a documented resume path, so a coach who comes back gets another prompt. Each
 * new prompt therefore disarms the one recorded before it, and only then is a new
 * button ever live. This removes opportunities to err; the claim fence (#135) is
 * still what survives the error that happens anyway.
 */
export const offerBotCreation = Effect.fn("BotWorker.offerBotCreation")(function* (
  env: CreationPromptEnv,
  setup: CoachBotProvisioningRepo.Provisioning,
  telegramFetch?: typeof globalThis.fetch,
) {
  const repo = yield* CoachBotProvisioningRepo.Service
  const api = apiFor(env.MANAGER_BOT_TOKEN, telegramFetch)
  // The prompt lives in the coach's private conversation with the manager bot,
  // so their Telegram id *is* the chat id — passed through as the id string the
  // row holds, exactly as `ManagerBotSender` addresses the same chat.
  const chatId = setup.coachTelegramId
  const copy = messages(setup.coachLanguage)

  // Only the keyboard comes off, not the text: the old message stays as the
  // record of what happened. Telegram gives a bot 48 hours to edit its own
  // message in a private chat and the coach may have deleted it, and neither is
  // a reason to refuse the resume they actually asked for — a prompt that keeps
  // its button is one the claim fence refuses anyway (#135).
  const previous = setup.promptMessageId
  if (previous !== undefined) {
    yield* bestEffort(
      telegram("editMessageReplyMarkup", () => api.editMessageReplyMarkup(chatId, previous)),
      (operation) => `creation prompt ${previous} in chat ${chatId} stayed armed: ${operation}`,
    )
  }

  const suggested = suggestedBotUsername(setup.workspace.name, setup.workspaceId)
  const sent = yield* telegram("sendMessage", () =>
    api.sendMessage(chatId, copy.invitationReserved(setup.workspace.name), {
      reply_markup: new InlineKeyboard().url(
        copy.createBotButton,
        createBotLink(env.MANAGER_BOT_USERNAME, suggested),
      ),
    }),
  )
  // The asymmetry here is deliberate. The coach is looking at a working button,
  // and failing their `/start` now would take it away to protect a *later*
  // disarm — or, on the redelivery a failure invites, send them a second one. So
  // the handle on this message is what is given up: the next `/start` would then
  // disarm an already-dead id and leave two armed prompts, which is precisely
  // the case the claim fence exists to survive (#135).
  yield* bestEffort(
    repo.recordPrompt(setup.id, sent.message_id, new Date(yield* Clock.currentTimeMillis)),
    (operation) =>
      `creation prompt ${sent.message_id} for attempt ${setup.id} was sent but not recorded: ${operation}`,
  )
  return sent.message_id
})

/**
 * Retire the creation prompt now that its bot is connected: the keyboard comes
 * off and the text becomes the confirmation.
 *
 * Edited, never deleted. The coach is looking at exactly this message expecting
 * confirmation, and deleting it would erase both the context and the record of
 * what happened. Omitting `reply_markup` on the edit is what removes the button.
 *
 * A failure here is logged and swallowed: the bot is connected the moment the
 * activation transaction commits, and neither an expired edit window nor a
 * message the coach deleted may undo that.
 */
export const settleCreationPrompt = Effect.fn("BotWorker.settleCreationPrompt")(function* (
  env: ManagerBotEnv,
  prompt: CoachBotProvisioningRepo.Provisioning,
  botUsername: string,
  telegramFetch?: typeof globalThis.fetch,
) {
  const messageId = prompt.promptMessageId
  if (messageId === undefined) return
  const api = apiFor(env.MANAGER_BOT_TOKEN, telegramFetch)
  yield* bestEffort(
    telegram("editMessageText", () =>
      api.editMessageText(
        prompt.coachTelegramId,
        messageId,
        messages(prompt.coachLanguage).promptConnected(botUsername),
      ),
    ),
    (operation) =>
      `coach bot @${botUsername} is connected but its creation prompt ${messageId} stayed armed: ${operation}`,
  )
})

/**
 * What a `managed_bot` update settled into. Both cases are terminal and both are
 * a 200: the failure channel is reserved for what a redelivery could still fix.
 *
 * `NoOpenAttempt` is the coach who created a second bot (#135) — by tapping the
 * creation entry point twice, or coming back to it later. The fence refuses it
 * by design, the first bot stays connected, and no retry can ever change that,
 * so it must not be answered like an outage.
 */
export type ManagedBotOutcome =
  | {
      readonly _tag: "Connected"
      readonly installation: CoachBotProvisioningRepo.Installation
    }
  | { readonly _tag: "NoOpenAttempt"; readonly botUsername: string }

export const provisionManagedBot = Effect.fn("BotWorker.provisionManagedBot")(function* (
  env: ProvisioningEnv,
  user: User,
  managedBot: User,
  webhookOrigin: string,
  telegramFetch?: typeof globalThis.fetch,
) {
  if (managedBot.username === undefined) {
    return yield* new TelegramSetupFailed({ operation: "managedBot.username" })
  }
  const repo = yield* CoachBotProvisioningRepo.Service
  const credentials = yield* CoachBotCredential.Service
  const now = new Date(yield* Clock.currentTimeMillis)
  const managerApi = apiFor(env.MANAGER_BOT_TOKEN, telegramFetch)
  // `exactOptionalPropertyTypes` refuses an explicit `undefined` here, and both
  // configuration branches need the same seam.
  const injectedFetch = telegramFetch === undefined ? {} : { telegramFetch }

  const existing = yield* repo.findByBotId(String(managedBot.id)).pipe(Effect.result)
  if (Result.isSuccess(existing)) {
    const token = yield* telegram("getManagedBotToken", () =>
      managerApi.getManagedBotToken(managedBot.id),
    )
    const profile = yield* repo.workspaceProfile(existing.success.workspaceId)
    yield* setCoachBotMenuButton({
      token,
      botId: existing.success.telegramBotId,
      miniAppBaseUrl: env.COACH_MINI_APP_URL,
      ...injectedFetch,
    })
    const configured = yield* configureCoachBot({
      env,
      token,
      botId: existing.success.telegramBotId,
      workspace: profile,
      coachName: coachDisplayName(user, profile.name),
      ...injectedFetch,
    })
    // Armed *before* the write here, which is the opposite of the first-time
    // branch below, and deliberately so. This bot already has an installation —
    // that is how we got into this branch — so there is no window of the kind
    // #150 closes: no update can arrive before a row that already exists. What
    // there is instead is a working bot to lose. This branch mints a fresh secret
    // and the row only ever holds its hash, so committing the new hash before
    // Telegram accepts the new secret is what would strand a healthy bot on a
    // secret nothing recognises, and every coach message would 401 until another
    // `managed_bot` update happened along. Arming first keeps a failure here
    // exactly as harmless as it was before the reorder: we return, the row still
    // carries the secret Telegram is still presenting, and the bot keeps working.
    //
    // And no `dropPendingUpdates`, also deliberately: this bot has been listening
    // for a while, so its queue is the coach's and their clients' ordinary
    // messages. Dropping them here would throw away conversation to tidy up a
    // re-configuration — the first-time branch drops because the only thing queued
    // there is a `/start` it has already answered itself (#154).
    yield* armCoachBotWebhook({
      token,
      botId: existing.success.telegramBotId,
      secret: configured.secret,
      webhookOrigin,
      ...injectedFetch,
    })
    return {
      _tag: "Connected",
      installation: yield* repo.rotate({
        telegramBotId: String(managedBot.id),
        encryptedToken: yield* credentials.encrypt(token),
        webhookSecretHash: yield* sha256(configured.secret),
        botInfo: configured.botInfo,
        username: managedBot.username,
        now,
      }),
    } as const
  }
  if (existing.failure._tag !== "CoachBotProvisioningRepo.InstallationNotFound") {
    return yield* existing.failure
  }

  const claimed = yield* repo
    .claim(TelegramId.make(String(user.id)), String(managedBot.id), managedBot.username, now)
    .pipe(Effect.result)
  if (Result.isFailure(claimed)) {
    // `not-found` is the whole of "this coach has no open attempt": the fence
    // matched nothing and no row anywhere carries this bot id. Deterministic, so
    // a retry can only repeat it — every other refusal keeps its failure.
    if (
      claimed.failure._tag === "CoachBotProvisioningRepo.ProvisioningUnavailable" &&
      claimed.failure.reason === "not-found"
    ) {
      return { _tag: "NoOpenAttempt", botUsername: managedBot.username } as const
    }
    return yield* claimed.failure
  }
  const provisioning = claimed.success
  const token = yield* telegram("getManagedBotToken", () =>
    managerApi.getManagedBotToken(managedBot.id),
  )
  // First of all, and before the coach is told anything: their client caches the
  // menu button when it opens the chat, and it opens the chat on the same tap that
  // brought us here (#156). Also the step that validates the Mini App URL, so an
  // unusable one fails before any promise is made.
  yield* setCoachBotMenuButton({
    token,
    botId: String(managedBot.id),
    miniAppBaseUrl: env.COACH_MINI_APP_URL,
    ...injectedFetch,
  })
  // Then the message that has to beat the coach's own thumb: Telegram has already
  // offered them **Start bot**, and everything below — an avatar upload, two
  // descriptions, the activation transaction — is the several seconds they used to
  // spend looking at an empty chat (#154).
  const announcement = yield* announceCoachBotSetup({
    token,
    chatId: provisioning.coachTelegramId,
    language: provisioning.coachLanguage,
    ...injectedFetch,
  })
  const configured = yield* configureCoachBot({
    env,
    token,
    botId: String(managedBot.id),
    workspace: provisioning.workspace,
    coachName: coachDisplayName(user, provisioning.workspace.name),
    ...injectedFetch,
  })
  const installation = yield* repo.complete({
    provisioningId: provisioning.id,
    encryptedToken: yield* credentials.encrypt(token),
    webhookSecretHash: yield* sha256(configured.secret),
    botInfo: configured.botInfo,
    now,
  })
  // The bot is connected, so the button that created it has no business staying
  // live — and only a *completed* activation retires it. A partial failure above
  // returns before this point, leaving that button tappable so the coach can
  // resume, which is exactly what the runbook tells them to do.
  //
  // Before the webhook step, deliberately: that step is the one thing that can
  // now fail *after* the workspace is connected, and the coach must not be left
  // looking at a live creation button for a bot they already have.
  yield* settleCreationPrompt(env, provisioning, installation.username, telegramFetch)
  // The end of the sentence the announcement started, in the same message — and
  // *before* the webhook is armed, which is what makes "greeted once" true rather
  // than likely. Once the route is live the bot's own `/start` handler greets
  // whoever taps Start; doing that while this edit was still in flight would greet
  // the coach twice for one tap, in two different languages (the handler reads the
  // Telegram client's, this reads the workspace owner's).
  yield* greetCoachOnBotReady({
    token,
    chatId: provisioning.coachTelegramId,
    language: provisioning.coachLanguage,
    botId: String(managedBot.id),
    miniAppBaseUrl: env.COACH_MINI_APP_URL,
    ...(announcement === undefined ? {} : { announcementMessageId: announcement }),
    ...injectedFetch,
  })
  // Last, so no update can reach the bot's route before the row that serves it
  // exists (#150) — and dropping what Telegram held while it waited, because the
  // coach's early `/start` has just been answered above rather than needing a
  // replay that would arrive as a second greeting (#154).
  yield* armCoachBotWebhook({
    token,
    botId: String(managedBot.id),
    secret: configured.secret,
    webhookOrigin,
    dropPendingUpdates: true,
    ...injectedFetch,
  })
  return { _tag: "Connected", installation } as const
})

/**
 * What the admin is told, per kind of coach notification.
 *
 * These live here rather than in `messages.ts`, which is a tri-lingual
 * *coach-facing* interface: an English-only admin string added there would
 * quietly break that module's contract. Admin copy is English-only by decision
 * (admin-surface.md), so it sits beside the loop that sends it.
 *
 * An unknown kind returns `undefined` and is left in the queue rather than
 * delivered with the wrong words — a row a newer deploy enqueued must wait for
 * the deploy that knows how to phrase it, not arrive mislabelled.
 */
export const coachNotificationText = (
  notification: CoachBotProvisioningRepo.PendingNotification,
): string | undefined => {
  switch (notification.kind) {
    case CoachNotification.Kind.BotConnected:
      return `Coach bot @${notification.botUsername} is connected to “${notification.workspaceName}”.`
    case CoachNotification.Kind.OnboardingComplete:
      return `“${notification.workspaceName}” finished onboarding — the coach accepted the terms and opened @${notification.botUsername}.`
    default:
      return undefined
  }
}

/**
 * Deliver the admin-facing coach notifications that are due. Claim, lease and
 * retry mechanics are the repository's; this only decides what each row says.
 */
export const deliverCoachNotifications = Effect.fn("BotWorker.deliverCoachNotifications")(
  function* () {
    const repo = yield* CoachBotProvisioningRepo.Service
    const sender = yield* ManagerBotSender.Service
    const now = new Date(yield* Clock.currentTimeMillis)
    const notifications = yield* repo.pendingNotifications(now, 20)
    yield* Effect.forEach(
      notifications,
      (notification) => {
        const text = coachNotificationText(notification)
        // Its lease has already been taken and its attempt counted, so an
        // unrecognised kind simply becomes available again on the next sweep.
        if (text === undefined) return Effect.void
        return sender.sendText(notification.recipientTelegramId, text).pipe(
          Effect.flatMap(() => repo.markNotificationDelivered(notification.id, now)),
          Effect.catchTag("ManagerBotSender.SendFailed", () =>
            repo.deferNotification(notification.id, now),
          ),
        )
      },
      { concurrency: 4 },
    )
  },
)
