import { describe, expect, it } from "@effect/vitest"
import { CoachBotProvisioningRepo } from "@praximo/db"
import { CoachLanguage, CoachOnboardingInviteId, TelegramId, WorkspaceId } from "@praximo/domain"
import { CoachBotCredential } from "@praximo/telegram"
import type { User } from "grammy/types"
import { ConfigProvider, Effect, Layer, Logger } from "effect"
import { GrammyError } from "grammy"
import {
  unusedClientAcceptanceRepo,
  unusedHealthRepo,
  unusedManagerSender,
  unusedRegistry,
} from "./__tests__/coach-bot-provisioning.ts"
import { CoachBotProvisioning } from "./coach-bot-provisioning.ts"
import { messages } from "./messages.ts"
import { announcementFailure } from "./provisioning.ts"
import { BRANDING_AVATAR_BYTES, BRANDING_AVATAR_KEY, uploadsStub } from "./__tests__/uploads.ts"

/**
 * What the coach sees while their bot is being set up (#154).
 *
 * Telegram ends its creation dialog with a **Start bot** button, so the coach taps
 * it seconds before there is anything to answer with. They used to get silence,
 * conclude nothing had happened, and tap again. The contract now is: **one tap,
 * an immediate answer, and that same message becoming the greeting.**
 */

const coach = TelegramId.make("800000101")
const workspaceId = WorkspaceId.make("ws_019f92510000700080000000")
const MANAGED_BOT_ID = "9100010"
const MANAGED_BOT_USERNAME = "ada_coach_bot"
const MANAGED_BOT_TOKEN = "9100010:AAHkq2Lb8fN1sQx3TzVpYr7WcJd4MgEuKvB"
const MANAGER_BOT_TOKEN = "manager-token"
const ANNOUNCEMENT_MESSAGE_ID = 777

const env = {
  MANAGER_BOT_TOKEN,
  MANAGER_BOT_USERNAME: "PraximoManagerBot",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: BRANDING_AVATAR_KEY,
  COACH_MINI_APP_URL: "https://coach.praximo.io/",
  CLIENT_APP_URL: "https://me.praximo.io",
  UPLOADS: uploadsStub({ [BRANDING_AVATAR_KEY]: BRANDING_AVATAR_BYTES }).bucket,
}

const user: User = { id: Number(coach), is_bot: false, first_name: "Ada", language_code: "en" }
const managedBot: User = {
  id: Number(MANAGED_BOT_ID),
  is_bot: true,
  first_name: "Ada Coaching",
  username: MANAGED_BOT_USERNAME,
}

const unsupported = () => Effect.die(new Error("unsupported test operation"))

const credentialLayer = Layer.succeed(
  CoachBotCredential.Service,
  CoachBotCredential.Service.of({
    encrypt: (token) => Effect.succeed(`sealed:${token}`),
    decrypt: (envelope) => Effect.succeed(envelope.replace(/^sealed:/, "")),
  }),
)

/** The coach's language is the workspace owner's, not their Telegram client's. */
const attempt: CoachBotProvisioningRepo.Provisioning = {
  id: "cbp_test_800000101",
  inviteId: CoachOnboardingInviteId.make("ci_test"),
  workspaceId,
  coachTelegramId: coach,
  keyboardRequestId: 4242,
  status: "configuring",
  workspace: { name: "Ada Coaching" },
  issuedByTelegramId: TelegramId.make("100000001"),
  coachLanguage: CoachLanguage.make("ru"),
}

const installation: CoachBotProvisioningRepo.Activation = {
  workspaceId,
  telegramBotId: MANAGED_BOT_ID,
  username: MANAGED_BOT_USERNAME,
  encryptedToken: `sealed:${MANAGED_BOT_TOKEN}`,
  webhookSecretHash: "installed-hash",
  botInfo: {},
  reconnected: false,
}

const repoLayer = Layer.succeed(
  CoachBotProvisioningRepo.Service,
  CoachBotProvisioningRepo.Service.of({
    prepare: unsupported,
    claim: () => Effect.succeed(attempt),
    recordPrompt: unsupported,
    ingestCandidate: unsupported,
    findCandidateByBotId: unsupported,
    complete: () => Effect.succeed(installation),
    reopenForRelink: unsupported,
    findByBotId: (telegramBotId) =>
      Effect.fail(new CoachBotProvisioningRepo.InstallationNotFound({ key: telegramBotId })),
    findInFlightManagedAttempt: unsupported,
    findByWorkspace: unsupported,
    workspaceProfile: unsupported,
    rotate: unsupported,
    pendingNotifications: unsupported,
    markNotificationDelivered: unsupported,
    deferNotification: unsupported,
  }),
)

interface TelegramCall {
  readonly method: string
  readonly token: string
  readonly body: Record<string, unknown>
}

interface TelegramStub {
  readonly fetch: typeof globalThis.fetch
  readonly calls: Array<TelegramCall>
}

/**
 * `unopenedChat` is Telegram's 403 for a bot messaging a user who has not started
 * it — the shape of "the coach has not tapped Start yet".
 */
const telegramStub = (
  options: { readonly failing?: ReadonlyArray<string>; readonly unopenedChat?: boolean } = {},
): TelegramStub => {
  const calls: Array<TelegramCall> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const [, credential = "", method = ""] = new URL(input.toString()).pathname.split("/")
    const raw = init?.body
    calls.push({
      method,
      token: credential.replace(/^bot/, ""),
      body: typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : {},
    })
    if (options.failing?.includes(method) === true) {
      return Response.json({ ok: false, error_code: 400, description: "Bad Request" })
    }
    if (method === "sendMessage") {
      if (options.unopenedChat === true) {
        return Response.json({
          ok: false,
          error_code: 403,
          description: "Forbidden: bot can't initiate conversation with a user",
        })
      }
      return Response.json({ ok: true, result: { message_id: ANNOUNCEMENT_MESSAGE_ID } })
    }
    if (method === "editMessageText") {
      return Response.json({ ok: true, result: { message_id: ANNOUNCEMENT_MESSAGE_ID } })
    }
    if (method === "getManagedBotToken")
      return Response.json({ ok: true, result: MANAGED_BOT_TOKEN })
    if (method === "getMe") {
      return Response.json({
        ok: true,
        result: {
          id: Number(MANAGED_BOT_ID),
          is_bot: true,
          first_name: "Ada Coaching",
          username: MANAGED_BOT_USERNAME,
          can_join_groups: false,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
        },
      })
    }
    return Response.json({ ok: true, result: true })
  }
  return { fetch, calls }
}

const provision = (telegram: TelegramStub) =>
  Effect.flatMap(CoachBotProvisioning.Service, (service) =>
    service.provisionManagedBot(user, managedBot, "https://bot.praximo.test"),
  ).pipe(
    Effect.provide(
      CoachBotProvisioning.testLayer(env.UPLOADS, telegram.fetch).pipe(
        Layer.provide(
          Layer.mergeAll(
            repoLayer,
            credentialLayer,
            unusedHealthRepo,
            unusedClientAcceptanceRepo,
            unusedRegistry,
            unusedManagerSender,
          ),
        ),
      ),
    ),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
  )

const coachBotCalls = (telegram: TelegramStub, method: string): ReadonlyArray<TelegramCall> =>
  telegram.calls.filter((call) => call.method === method && call.token === MANAGED_BOT_TOKEN)

describe("what the coach sees while their bot is set up", () => {
  it.effect("says so before anything slow, in the workspace's language", () =>
    Effect.gen(function* () {
      const telegram = telegramStub()

      yield* provision(telegram)

      const announcement = coachBotCalls(telegram, "sendMessage")[0]
      expect(announcement?.body).toMatchObject({
        chat_id: coach,
        // `ru` is the owner member's language; the coach's Telegram client says
        // `en`, and it does not get a say once a provisioning row is in hand.
        text: messages("ru").botSettingUp,
      })

      // Ahead of the avatar upload and everything after it — that is the wait it
      // exists to explain.
      const methods = telegram.calls.map((call) => call.method)
      expect(methods.indexOf("sendMessage")).toBeLessThan(methods.indexOf("setMyProfilePhoto"))
    }),
  )

  it.effect("puts the menu button on the bot before telling the coach anything", () =>
    Effect.gen(function* () {
      const telegram = telegramStub()

      yield* provision(telegram)

      // The coach's client caches the bot's menu button when it opens the chat,
      // and it opens the chat on the same tap that brought this update here. So
      // the button goes on first — ahead of the announcement, and ahead of every
      // slow step (#156). Verified live: setting it last left the coach without an
      // Open button until they reopened the chat.
      const methods = telegram.calls.map((call) => call.method)
      expect(methods.indexOf("setChatMenuButton")).toBeGreaterThanOrEqual(0)
      expect(methods.indexOf("setChatMenuButton")).toBeLessThan(methods.indexOf("sendMessage"))
    }),
  )

  it.effect("turns that message into the greeting rather than sending a second one", () =>
    Effect.gen(function* () {
      const telegram = telegramStub()

      yield* provision(telegram)

      // One message from first tap to ready: the same line that promised a few
      // seconds is the one that says it is done.
      expect(coachBotCalls(telegram, "sendMessage")).toHaveLength(1)
      const greeting = coachBotCalls(telegram, "editMessageText")[0]
      expect(greeting?.body).toMatchObject({
        chat_id: coach,
        message_id: ANNOUNCEMENT_MESSAGE_ID,
        text: messages("ru").botReady,
      })
      expect(greeting?.body.reply_markup).toEqual({
        inline_keyboard: [
          [
            {
              text: messages("ru").openButton,
              web_app: { url: `https://coach.praximo.io/?b=${MANAGED_BOT_ID}` },
            },
          ],
        ],
      })
    }),
  )

  it.effect("greets before the route can, then drops what Telegram held", () =>
    Effect.gen(function* () {
      const telegram = telegramStub()

      yield* provision(telegram)

      // Order is the whole of "greeted once". The bot's own `/start` handler
      // greets whoever taps Start once the webhook is armed, so the edit has to be
      // finished first — otherwise one tap lands two greetings, in two different
      // languages, since the handler reads the Telegram client's.
      const methods =
        coachBotCalls(telegram, "editMessageText").length > 0
          ? telegram.calls.map((call) => call.method)
          : []
      expect(methods.indexOf("editMessageText")).toBeLessThan(methods.indexOf("setWebhook"))
      // And the tap that has just been answered is not left for Telegram to
      // replay into a second greeting.
      const armed = coachBotCalls(telegram, "setWebhook")[0]
      expect(armed?.body).toMatchObject({ drop_pending_updates: true })
    }),
  )

  it.effect("tells an undelivered announcement apart from a chat nobody opened", () =>
    Effect.gen(function* () {
      // Not a 403: the coach may well be sitting in the chat and the send simply
      // did not land. Treating this as "they are not there" is what would make the
      // log say something false — the behaviour is the same either way, but only
      // one of the two is worth a warning.
      const telegram = telegramStub({ failing: ["sendMessage"] })

      const outcome = yield* provision(telegram)

      expect(outcome).toMatchObject({ _tag: "Connected" })
      // No id to edit, so the greeting is its own message rather than a lost one.
      const sends = coachBotCalls(telegram, "sendMessage")
      expect(sends).toHaveLength(2)
      expect(sends[1]?.body).toMatchObject({ text: messages("ru").botReady })
      expect(coachBotCalls(telegram, "editMessageText")).toHaveLength(0)
    }),
  )

  it.effect("greets a coach who never opened the bot, having had nothing to announce", () =>
    Effect.gen(function* () {
      // Telegram refuses a message to a user who has not started the bot, which is
      // exactly how we learn they are not sitting in the chat.
      const telegram = telegramStub({ unopenedChat: true })

      const outcome = yield* provision(telegram)

      expect(outcome).toMatchObject({ _tag: "Connected" })
      const sends = coachBotCalls(telegram, "sendMessage")
      // Two attempts, no edit: the announcement was refused, so the greeting is a
      // fresh message rather than an edit of one that does not exist.
      expect(sends).toHaveLength(2)
      expect(sends[1]?.body).toMatchObject({ chat_id: coach, text: messages("ru").botReady })
      expect(coachBotCalls(telegram, "editMessageText")).toHaveLength(0)
    }),
  )

  it.effect("keeps what Telegram held for a coach it has greeted with nothing", () =>
    Effect.gen(function* () {
      // The same refusal as above, and the reason it must not end in a drop. A
      // coach who taps **Start bot** after this run began has been greeted by
      // neither message — both were refused for want of a chat to write in — and
      // the `/start` behind that tap is queued precisely because the webhook is
      // being armed only now. Dropping it leaves them in an empty chat; delivered,
      // it reaches the bot's own `/start` handler and the same **Open** button.
      const telegram = telegramStub({ unopenedChat: true })

      yield* provision(telegram)

      const armed = coachBotCalls(telegram, "setWebhook")[0]
      expect(armed?.body).not.toHaveProperty("drop_pending_updates")
    }),
  )

  it.effect("connects the bot even when neither message can be delivered", () =>
    Effect.gen(function* () {
      const telegram = telegramStub({ failing: ["sendMessage", "editMessageText"] })

      const outcome = yield* provision(telegram)

      // The bot is connected the moment the activation transaction commits, and a
      // greeting Telegram refuses may not undo that.
      expect(outcome).toEqual({ _tag: "Connected", installation })
    }),
  )
})

/** `GrammyError`'s constructor shape, as grammY builds it from a Bot API reply. */
const botApiError = (code: number, description: string): GrammyError =>
  new GrammyError(
    `Call to 'sendMessage' failed!`,
    { ok: false, error_code: code, description },
    "sendMessage",
    {},
  )

/** Every line the run logged, so an operator's `grep` can be asserted. */
const capturingLogs = (lines: Array<string>) =>
  Logger.layer([Logger.make((options) => lines.push(String(options.message)))])

describe("what the log says about an announcement that did not land", () => {
  it.effect("names the bot, so the runbook's grep-by-bot-id finds it", () =>
    Effect.gen(function* () {
      const lines: Array<string> = []
      // The coach has not tapped **Start bot**, so there is nobody to tell.
      const telegram = telegramStub({ unopenedChat: true })

      yield* provision(telegram).pipe(Effect.provide(capturingLogs(lines)))

      const announcement = lines.find((line) => line.includes("nothing to announce"))
      // The runbook tells an operator to check the Worker log for the bot id —
      // twice — so a line without it is a line their method cannot find (#160).
      expect(announcement).toContain(MANAGED_BOT_ID)
      // And the chat is named as a chat. This line used to read "coach bot
      // <chat id>", sending whoever read it looking for a bot that never existed.
      expect(announcement).toContain(`chat ${coach}`)
      expect(announcement).not.toContain(`coach bot ${coach}`)
    }),
  )

  it.effect("says something different when the send should have landed", () =>
    Effect.gen(function* () {
      const lines: Array<string> = []
      const telegram = telegramStub({ failing: ["sendMessage"] })

      yield* provision(telegram).pipe(Effect.provide(capturingLogs(lines)))

      // Only one of the two is a fault, and the log has to keep them apart: the
      // greeting silently becoming its own message is the consequence to explain.
      const undelivered = lines.find((line) => line.includes("undelivered"))
      expect(undelivered).toContain(MANAGED_BOT_ID)
      expect(lines.some((line) => line.includes("nothing to announce"))).toBe(false)
    }),
  )
})

describe("why a setup announcement did not land", () => {
  it("reads a refused chat as the coach not having opened the bot", () => {
    // The two shapes Telegram uses for "there is nobody there".
    expect(
      announcementFailure(
        botApiError(403, "Forbidden: bot can't initiate conversation with a user"),
      ),
    ).toBe("unopened")
    expect(announcementFailure(botApiError(400, "Bad Request: chat not found"))).toBe("unopened")
  })

  it("does not mistake a send that should have worked for an empty chat", () => {
    // This is the distinction the log rests on: calling a rate limit or a network
    // failure "the coach has not opened it" would make the log state something
    // false about the coach, on the one path an operator reads to explain a
    // complaint about setup.
    expect(announcementFailure(botApiError(429, "Too Many Requests: retry after 5"))).toBe(
      "undelivered",
    )
    expect(announcementFailure(botApiError(500, "Internal Server Error"))).toBe("undelivered")
    expect(announcementFailure(new Error("fetch failed"))).toBe("undelivered")
    expect(announcementFailure(undefined)).toBe("undelivered")
  })
})
