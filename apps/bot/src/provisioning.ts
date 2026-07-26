import { timingSafeEqual } from "node:crypto"
import { CoachOnboardingToken } from "@praximo/auth"
import {
  ClientAcceptanceRepo,
  CoachBotProvisioningRepo,
  CoachNotification,
  CoachOnboardingRepo,
} from "@praximo/db"
import { type CoachLanguage, TelegramId, type WorkspaceId } from "@praximo/domain"
import { ClientLanguageNames } from "@praximo/i18n"
import { BotRegistry, CoachBotCredential, ManagerBotSender } from "@praximo/telegram"
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
 * Put the Mini App on the bot's in-chat menu button — **on the coach's own chat
 * first, and on the bot's default second.**
 *
 * The coach opens their chat by tapping **Start bot** the moment the bot exists,
 * which is the same moment the `managed_bot` update reaches us; their client reads
 * the bot's menu button then and caches what it read. Setting the button after
 * that left them looking at its absence until they reopened the chat — verified by
 * `getChatMenuButton` returning the right `web_app` button while the coach saw
 * none (#156).
 *
 * **Doing it earlier does not fix that, and the scope is why.** `setChatMenuButton`
 * without a `chat_id` changes the *default*, and a default is the one thing
 * Telegram cannot deliver: `updateBotMenuButton` names one bot for one recipient,
 * so a change nobody is addressed by reaches a client only when it next refetches
 * the bot — on reopening the chat. No ordering wins a race against a value that is
 * never pushed. Addressed to the coach's own chat (`bots.setBotMenuButton` takes a
 * `user_id`), the same change is an update their client applies where it stands.
 *
 * So both go on. The targeted one is what the coach sees now; the default is what
 * every later client of that bot reads, including the coach's other devices and
 * their own clients. Targeted first, because it is the one somebody is waiting for.
 *
 * The Mini App URL is validated here because this is what consumes it, which also
 * means an unusable one fails before the coach has been promised anything.
 */
export const setCoachBotMenuButton = Effect.fn("BotWorker.setCoachBotMenuButton")(
  function* (input: {
    readonly token: string
    readonly botId: string
    /** The coach's Telegram id, which in their private chat is also the chat id. */
    readonly coachChatId: TelegramId
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
    const menuButton = {
      type: "web_app",
      text: CoachMenuButtonText,
      web_app: { url: miniAppUrl },
    } as const
    yield* telegram("setChatMenuButton.chat", () =>
      api.setChatMenuButton({ chat_id: Number(input.coachChatId), menu_button: menuButton }),
    )
    yield* telegram("setChatMenuButton.default", () =>
      api.setChatMenuButton({ menu_button: menuButton }),
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

export interface CoachBotReconfiguration {
  readonly env: ProvisioningEnv
  readonly token: string
  readonly botId: string
  readonly workspace: CoachBotProvisioningRepo.WorkspaceProfile
  readonly coachName: string
  /**
   * The coach's own chat, for the addressed menu button. Absent only where no
   * owner is bound, which a connected workspace does not produce — the default
   * button still goes on, so the bot is never left without one.
   */
  readonly coachChatId?: TelegramId
  /**
   * Where to point the webhook. Absent leaves it exactly as Telegram already has
   * it, which is what the returned `armed` reports: a caller that did not arm
   * must not record a secret Telegram has never seen (ADR 0004).
   */
  readonly webhookOrigin?: string
  readonly telegramFetch?: typeof globalThis.fetch
}

/**
 * Everything an *already installed* bot needs done to it, in the one order ADR
 * 0004 fixes — menu button, branding, then the webhook, and only then may the
 * caller rewrite the row.
 *
 * It exists because two callers now re-configure a live bot: a redelivered
 * `managed_bot` update, and the health repair that follows a refreshed
 * credential (#55). The order is the load-bearing part — arming before the write
 * is what stops a new secret hash landing on a bot Telegram has not accepted it
 * for — so it may not exist twice.
 *
 * Deliberately *not* the first-time path, which arms last and for the opposite
 * reason: there the window #150 closes is a bot delivering before its row
 * exists, and there is no working configuration to lose.
 */
export const reconfigureCoachBot = Effect.fn("BotWorker.reconfigureCoachBot")(function* (
  input: CoachBotReconfiguration,
) {
  const injectedFetch =
    input.telegramFetch === undefined ? {} : { telegramFetch: input.telegramFetch }
  // The coach's own chat first: a client caches the menu button when it opens
  // the chat, and a default is the one thing Telegram never pushes (#156).
  if (input.coachChatId !== undefined) {
    yield* setCoachBotMenuButton({
      token: input.token,
      botId: input.botId,
      coachChatId: input.coachChatId,
      miniAppBaseUrl: input.env.COACH_MINI_APP_URL,
      ...injectedFetch,
    })
  }
  const configured = yield* configureCoachBot({
    env: input.env,
    token: input.token,
    botId: input.botId,
    workspace: input.workspace,
    coachName: input.coachName,
    ...injectedFetch,
  })
  // No `dropPendingUpdates`, deliberately: this bot has been listening for a
  // while, so its queue is the coach's and their clients' ordinary messages.
  // Dropping them to tidy up a re-configuration would throw away conversation.
  if (input.webhookOrigin !== undefined) {
    yield* armCoachBotWebhook({
      token: input.token,
      botId: input.botId,
      secret: configured.secret,
      webhookOrigin: input.webhookOrigin,
      ...injectedFetch,
    })
  }
  return { ...configured, armed: input.webhookOrigin !== undefined }
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
    /**
     * The bot this is about. Carried for the log alone: the runbook tells an
     * operator to grep the Worker log by bot id, and every other line on this
     * path already answers to that (#160).
     */
    readonly botId: string
    readonly chatId: TelegramId
    readonly language: CoachLanguage
    readonly telegramFetch?: typeof globalThis.fetch
  }) {
    const api = apiFor(input.token, input.telegramFetch)
    // Deliberately not `telegram()`, which drops the cause: this is the one place
    // that has to tell "the coach is not in the chat" from "the send did not
    // land", and only the Bot API error code says which.
    const sent = yield* Effect.tryPromise({
      try: () =>
        api.sendMessage(input.chatId, messages(input.language).botSettingUp, {
          parse_mode: "HTML",
        }),
      catch: announcementFailure,
    }).pipe(Effect.result)
    if (Result.isSuccess(sent)) return sent.success.message_id
    if (sent.failure === "unopened") {
      // The ordinary case, and a useful signal rather than a fault: the coach has
      // not tapped **Start bot**, so there is nobody in the chat to tell.
      yield* Effect.logInfo(
        `coach bot ${input.botId}: nothing to announce to — chat ${input.chatId} has not been opened by its coach yet`,
      )
      return undefined
    }
    // Anything else is a send that should have landed, and may even have arrived
    // without us learning its id — in which case the greeting becomes its own
    // message rather than an edit of this one. A warning, not a shrug.
    yield* Effect.logWarning(
      `coach bot ${input.botId}: setup announcement to chat ${input.chatId} undelivered; the greeting will be a new message`,
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
 *
 * **Whether it landed is the caller's business**, which is why this reports it
 * rather than swallowing it whole: it is the only evidence that the coach has
 * been greeted, and therefore the only thing that licenses discarding the
 * `/start` Telegram is holding for them.
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
          api.sendMessage(input.chatId, copy.botReady, {
            parse_mode: "HTML",
            reply_markup: keyboard,
          }),
        ).pipe(Effect.asVoid)
      : telegram("editMessageText", () =>
          api.editMessageText(input.chatId, announced, copy.botReady, {
            parse_mode: "HTML",
            reply_markup: keyboard,
          }),
        ).pipe(Effect.asVoid)
  const delivered = yield* Effect.result(delivery)
  if (Result.isFailure(delivered)) {
    yield* Effect.logWarning(
      `coach bot ${input.botId} is connected but its coach was not greeted: ${delivered.failure.operation}`,
    )
    return false
  }
  return true
})

/**
 * `language` is the sender's own Telegram client language, narrowed. It is the
 * first signal about the coach that comes from the coach themselves, and the
 * claim writes it to `member.language` (#130) — so a coach whose Telegram is
 * Ukrainian is spoken to in Ukrainian from the very next message, without a
 * screen having asked anything. The Mini App's onboarding is where they get to
 * disagree with it.
 */
export const prepareOnboarding = Effect.fn("BotWorker.prepareOnboarding")(function* (
  parameter: string,
  telegramUserId: number,
  language: CoachLanguage,
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
    language,
    new Date(yield* Clock.currentTimeMillis),
  )
})

/**
 * Put a coach whose bot stopped working back on their own attempt row, ready to
 * be offered creation again (#55).
 *
 * `undefined` means there is nothing to recover — the identity is not a coach,
 * or their bot is fine. Recovery is deliberately not an admin action: `reissue`
 * requires an unbound owner and an `awaiting_setup` bot, and a workspace that
 * needs re-linking is neither.
 */
export const prepareRelink = Effect.fn("BotWorker.prepareRelink")(function* (
  telegramUserId: number,
) {
  const repo = yield* CoachBotProvisioningRepo.Service
  return yield* repo.reopenForRelink(
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
 * Telegram's shape for a bot display name: 1–64 characters, no other rule.
 */
const BotNameMaxLength = 64

/**
 * The display name offered to a coach, pre-filled into the creation deep link
 * and editable by them in Telegram's own dialog.
 *
 * The workspace name, which the coach is already reading: the prompt this link
 * rides on names the workspace in its own text, and the suggested username is
 * derived from it too. Clamped rather than validated because Telegram places no
 * constraint on a bot name beyond its length, and blank-guarded because a name
 * of nothing is exactly the state that leaves the dialog unable to proceed.
 */
export const suggestedBotName = (workspaceName: string): string => {
  const trimmed = workspaceName.trim().slice(0, BotNameMaxLength).trim()
  return trimmed.length === 0 ? "Praximo Coach" : trimmed
}

/**
 * Where the coach launches creation from: Telegram's own managed-bot dialog,
 * opened by deep link rather than by a `request_managed_bot` reply-keyboard
 * button.
 *
 * The button does not work on Telegram iOS — the client degrades the *whole*
 * keyboard into a share action, so even a plain button beside it stops
 * responding (#134). This link opens the same dialog on every client, drives the
 * same MTProto `bots.createBot`, and produces the same `managed_bot` update; it
 * rides an inline `url` button, the most basic inline type there is.
 *
 * **Both suggestions travel with it, and the name is not optional in practice.**
 * `bots.createBot` takes a display name of 1–64 characters, and the link's
 * `name` parameter is what fills that field: left off, api/links says of it
 * "Can be empty, in which case the user must choose a name before invoking
 * bots.createBot" — so the dialog opens with an empty required field and its
 * **Create** button simply does not respond until the coach notices and types
 * one. That is not a one-tap flow, and it reads to the coach as a broken button
 * rather than as a form they have not finished.
 */
/**
 * The creation prompt's second button (#164) — "I already have a bot", which
 * answers with the @BotFather steps instead of navigating anywhere.
 *
 * The language rides in the callback data. It is bot-authored and Telegram
 * echoes it back verbatim, so this is our own value coming home rather than a
 * claim by the sender — and it spares a database round trip on a tap that
 * changes no state. The handler still narrows it before use.
 */
export const HaveBotCallbackPrefix = "have-bot:"

export const haveBotCallbackData = (language: CoachLanguage): string =>
  `${HaveBotCallbackPrefix}${language}`

export const createBotLink = (
  managerBotUsername: string,
  suggestedUsername: string,
  suggestedName: string,
): string =>
  `https://t.me/newbot/${managerBotUsername}/${suggestedUsername}?name=${encodeURIComponent(
    suggestedName,
  )}`

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
  /**
   * Which sentence opens the prompt. `relink` is a coach coming back to a
   * workspace whose bot died (#55): nothing is being reserved for them, they are
   * reconnecting something they already have — and the invitation this attempt
   * rides on is long spent, so saying otherwise would be a lie.
   */
  intent: "invitation" | "relink" = "invitation",
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
  const opening =
    intent === "relink" ? copy.relinkReserved : copy.invitationReserved(setup.workspace.name)
  const sent = yield* telegram("sendMessage", () =>
    api.sendMessage(chatId, opening, {
      parse_mode: "HTML",
      // Two rows, one keyboard. The BotFather path used to be the tail paragraph
      // of a message everybody reads for the sake of the few who take it; as the
      // second button it is free until it is wanted (#164). Both come off
      // together on the disarm below, which is what keeps the one-live-button
      // invariant a property of the keyboard rather than of a button count.
      reply_markup: new InlineKeyboard()
        .url(
          copy.createBotButton,
          createBotLink(
            env.MANAGER_BOT_USERNAME,
            suggested,
            suggestedBotName(setup.workspace.name),
          ),
        )
        .row()
        .text(copy.haveBotButton, haveBotCallbackData(setup.coachLanguage)),
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
  /**
   * What this closed (#55). Named rather than a boolean, and the same shape
   * `offerBotCreation` opens with: "Setup finished" is the wrong end of the
   * sentence for a workspace that was set up months ago and has just come back.
   */
  outcome: "connected" | "reconnected" = "connected",
  telegramFetch?: typeof globalThis.fetch,
) {
  const messageId = prompt.promptMessageId
  if (messageId === undefined) return
  const api = apiFor(env.MANAGER_BOT_TOKEN, telegramFetch)
  const copy = messages(prompt.coachLanguage)
  yield* bestEffort(
    telegram("editMessageText", () =>
      api.editMessageText(
        prompt.coachTelegramId,
        messageId,
        outcome === "reconnected"
          ? copy.promptReconnected(botUsername)
          : copy.promptConnected(botUsername),
        { parse_mode: "HTML" },
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
    // That whole order lives in `reconfigureCoachBot`, which the health repair
    // shares (#55).
    const configured = yield* reconfigureCoachBot({
      env,
      token,
      botId: existing.success.telegramBotId,
      workspace: profile,
      coachName: coachDisplayName(user, profile.name),
      coachChatId: TelegramId.make(String(user.id)),
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

  const coachTelegramId = TelegramId.make(String(user.id))
  // Read out of the narrowed parameter: the guard at the top of this function is
  // what proves it is a string, and that narrowing does not survive a closure.
  const claimedUsername = managedBot.username
  const takeClaim = () =>
    repo.claim(coachTelegramId, String(managedBot.id), claimedUsername, now).pipe(Effect.result)

  let claimed = yield* takeClaim()
  if (
    Result.isFailure(claimed) &&
    claimed.failure._tag === "CoachBotProvisioningRepo.ProvisioningUnavailable" &&
    claimed.failure.reason === "not-found"
  ) {
    // A coach whose bot needs re-linking may create the new one without ever
    // tapping the recovery prompt — from @BotFather's own dialog, or from a link
    // they still had. Their attempt row is `completed`, so the fence matched
    // nothing, and answering `extraBotNotConnected` here would tell them their
    // workspace is fine when it is precisely not (#55). Reopening costs one
    // conditional write and does nothing at all for a healthy coach.
    const reopened = yield* repo.reopenForRelink(coachTelegramId, now).pipe(Effect.result)
    if (Result.isSuccess(reopened) && reopened.success !== undefined) {
      claimed = yield* takeClaim()
    }
  }
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
    coachChatId: provisioning.coachTelegramId,
    miniAppBaseUrl: env.COACH_MINI_APP_URL,
    ...injectedFetch,
  })
  // Then the message that has to beat the coach's own thumb: Telegram has already
  // offered them **Start bot**, and everything below — an avatar upload, two
  // descriptions, the activation transaction — is the several seconds they used to
  // spend looking at an empty chat (#154).
  const announcement = yield* announceCoachBotSetup({
    token,
    botId: String(managedBot.id),
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
  yield* settleCreationPrompt(
    env,
    provisioning,
    installation.username,
    installation.reconnected ? "reconnected" : "connected",
    telegramFetch,
  )
  // The end of the sentence the announcement started, in the same message — and
  // *before* the webhook is armed, which is what makes "greeted once" true rather
  // than likely. Once the route is live the bot's own `/start` handler greets
  // whoever taps Start; doing that while this edit was still in flight would greet
  // the coach twice for one tap, in two different languages (the handler reads the
  // Telegram client's, this reads the workspace owner's).
  const greeted = yield* greetCoachOnBotReady({
    token,
    chatId: provisioning.coachTelegramId,
    language: provisioning.coachLanguage,
    botId: String(managedBot.id),
    miniAppBaseUrl: env.COACH_MINI_APP_URL,
    ...(announcement === undefined ? {} : { announcementMessageId: announcement }),
    ...injectedFetch,
  })
  // Last, so no update can reach the bot's route before the row that serves it
  // exists (#150).
  //
  // **What Telegram is holding is dropped only if the coach has already been
  // greeted** (#154). The queue's one occupant is their `/start` from the
  // **Start bot** button, and dropping it is right when we have answered it
  // ourselves — a replay would then greet them a second time. But a coach who
  // taps **Start bot** *after* this run began has been greeted by nothing: both
  // sends above were refused because at the time there was no chat to write in,
  // and their `/start` is sitting in that queue precisely because the webhook is
  // only being armed now. Dropping it there is what leaves them looking at an
  // empty chat with no way in but the menu button. Delivered last, it reaches
  // the bot's own `/start` handler, which greets them with the same **Open**
  // button. The cost of being wrong in this direction is one greeting too many;
  // in the other it is none at all.
  yield* armCoachBotWebhook({
    token,
    botId: String(managedBot.id),
    secret: configured.secret,
    webhookOrigin,
    dropPendingUpdates: greeted,
    ...injectedFetch,
  })
  return { _tag: "Connected", installation } as const
})

/**
 * What each notification says, chosen by **the kind and the recipient together**
 * (#55). One event can queue a row for the coach and a row for the admin, so the
 * kind alone does not decide the words — or even the language.
 *
 * The admin's lines live here rather than in `messages.ts`, which is a
 * tri-lingual *coach-facing* interface: an English-only admin string added there
 * would quietly break that module's contract. Admin copy is English-only by
 * decision (admin-surface.md), so it sits beside the loop that sends it. The
 * coach's lines come from the catalog, in the language their workspace carries.
 *
 * An unrecognised pair returns `undefined` and is left in the queue rather than
 * delivered with the wrong words — a row a newer deploy enqueued must wait for
 * the deploy that knows how to phrase it, not arrive mislabelled.
 */
export const coachNotificationText = (
  notification: CoachBotProvisioningRepo.PendingNotification,
): string | undefined => {
  if (notification.recipientRole === CoachNotification.Role.Coach) {
    const copy = messages(notification.coachLanguage)
    switch (notification.kind) {
      case CoachNotification.Kind.BotRepaired:
        return copy.botRepaired(notification.botUsername)
      case CoachNotification.Kind.NeedsRelink:
        return copy.botNeedsRelink(notification.botUsername)
      default:
        return undefined
    }
  }
  switch (notification.kind) {
    case CoachNotification.Kind.BotConnected:
      return `Coach bot @${notification.botUsername} is connected to “${notification.workspaceName}”.`
    case CoachNotification.Kind.OnboardingComplete:
      return `“${notification.workspaceName}” finished onboarding — the coach accepted the terms and opened @${notification.botUsername}.`
    case CoachNotification.Kind.NeedsRelink:
      return `Coach bot @${notification.botUsername} in “${notification.workspaceName}” stopped working — Telegram rejected its token. The coach has been asked to reconnect it; no action is needed from you.`
    case CoachNotification.Kind.RelinkCompleted:
      return `“${notification.workspaceName}” is back online — the coach reconnected @${notification.botUsername}.`
    default:
      return undefined
  }
}

/**
 * Deliver the admin-facing coach notifications that are due. Claim, lease and
 * retry mechanics are the repository's; this only decides what each row says.
 */
/**
 * The client id a `client_accepted` row was deduplicated on.
 *
 * The key is composed as `client_accepted:<workspaceId>:<clientId>`, and the
 * client id is the only part of that row which names the *subject* — the coach
 * is being told about a person, not about their workspace.
 */
export const acceptedClientId = (dedupeKey: string): string | undefined => {
  const parts = dedupeKey.split(":")
  return parts.length === 3 && parts[0] === CoachNotification.Kind.ClientAccepted
    ? parts[2]
    : undefined
}

/**
 * The client-accepted push, delivered through the coach's **own** bot (#56).
 *
 * Not the manager's, for two reasons: that is the chat the client just walked
 * into, and a `web_app` button only opens the Mini App from the bot the app
 * belongs to. The button carries the client's own route, because "who accepted"
 * is a question best answered by the screen about them.
 */
const deliverClientAccepted = Effect.fn("BotWorker.deliverClientAccepted")(function* (
  env: { readonly COACH_MINI_APP_URL: string },
  notification: CoachBotProvisioningRepo.PendingNotification,
) {
  const clientId = acceptedClientId(notification.dedupeKey)
  if (clientId === undefined) return false
  const clients = yield* ClientAcceptanceRepo.Service
  const client = yield* clients.findAcceptedClient(clientId).pipe(Effect.orElseSucceed(() => undefined))
  if (client === undefined) return false

  const registry = yield* BotRegistry.Service
  const copy = messages(notification.coachLanguage)
  const route = new URL(env.COACH_MINI_APP_URL)
  route.hash = `#/clients/${clientId}`

  const sent = yield* registry
    .send(
      notification.workspaceId,
      copy.clientAccepted({
        name: client.name,
        ...(client.telegramName === undefined ? {} : { telegramName: client.telegramName }),
        ...(client.telegramUsername === undefined ? {} : { username: client.telegramUsername }),
        language: ClientLanguageNames[client.language ?? notification.coachLanguage],
      }),
      {
        parseMode: "HTML",
        button: { text: copy.openClientButton, webAppUrl: route.toString() },
      },
    )
    .pipe(Effect.as(true), Effect.orElseSucceed(() => false))
  return sent
})

export const deliverCoachNotifications = Effect.fn("BotWorker.deliverCoachNotifications")(
  function* (env: { readonly COACH_MINI_APP_URL: string }) {
    const repo = yield* CoachBotProvisioningRepo.Service
    const sender = yield* ManagerBotSender.Service
    const now = new Date(yield* Clock.currentTimeMillis)
    const notifications = yield* repo.pendingNotifications(now, 20)
    yield* Effect.forEach(
      notifications,
      (notification) => {
        if (notification.kind === CoachNotification.Kind.ClientAccepted) {
          return deliverClientAccepted(env, notification).pipe(
            Effect.flatMap((delivered) =>
              delivered
                ? repo.markNotificationDelivered(notification.id, now)
                : repo.deferNotification(notification.id, now),
            ),
          )
        }
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
