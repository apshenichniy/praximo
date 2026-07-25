import { describe, expect, it } from "@effect/vitest"
import { CoachBotProvisioningRepo, QueryFailed } from "@praximo/db"
import { CoachLanguage, CoachOnboardingInviteId, TelegramId, WorkspaceId } from "@praximo/domain"
import { CoachBotCredential } from "@praximo/telegram"
import type { User } from "grammy/types"
import { Effect, Layer } from "effect"
import { messages } from "./messages.ts"
import { createBotLink, offerBotCreation, provisionManagedBot } from "./provisioning.ts"
import { BRANDING_AVATAR_BYTES, BRANDING_AVATAR_KEY, uploadsStub } from "./__tests__/uploads.ts"

/**
 * The creation prompt's lifecycle (#134). Two invariants, and neither is about a
 * single message: **at most one live creation button exists in the coach's chat
 * at any moment, and none once the bot is connected.**
 */

const coach = TelegramId.make("800000101")
const workspaceId = WorkspaceId.make("ws_019f92510000700080000000")
const MANAGED_BOT_ID = "9100010"
const MANAGED_BOT_USERNAME = "ada_coach_bot"
const MANAGED_BOT_TOKEN = "9100010:AAHkq2Lb8fN1sQx3TzVpYr7WcJd4MgEuKvB"

const env = {
  MANAGER_BOT_TOKEN: "manager-token",
  MANAGER_BOT_USERNAME: "PraximoManagerBot",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: BRANDING_AVATAR_KEY,
  COACH_MINI_APP_URL: "https://stage.praximo.io/",
  UPLOADS: uploadsStub({ [BRANDING_AVATAR_KEY]: BRANDING_AVATAR_BYTES }).bucket,
}

const user: User = { id: Number(coach), is_bot: false, first_name: "Ada", language_code: "ru" }
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

const attempt = (
  overrides: Partial<CoachBotProvisioningRepo.Provisioning> = {},
): CoachBotProvisioningRepo.Provisioning => ({
  id: "cbp_test_800000101",
  inviteId: CoachOnboardingInviteId.make("ci_test"),
  workspaceId,
  coachTelegramId: coach,
  keyboardRequestId: 4242,
  status: "requested",
  workspace: { name: "Ada Coaching" },
  issuedByTelegramId: TelegramId.make("100000001"),
  coachLanguage: CoachLanguage.make("ru"),
  ...overrides,
})

const installation: CoachBotProvisioningRepo.Installation = {
  workspaceId,
  telegramBotId: MANAGED_BOT_ID,
  username: MANAGED_BOT_USERNAME,
  encryptedToken: `sealed:${MANAGED_BOT_TOKEN}`,
  webhookSecretHash: "installed-hash",
  botInfo: {},
}

interface RepoStub {
  readonly layer: Layer.Layer<CoachBotProvisioningRepo.Service>
  /** Prompt ids recorded against an attempt, in the order they were written. */
  readonly recorded: Array<{ readonly attemptId: string; readonly promptMessageId: number }>
  readonly completed: Array<string>
}

const repoStub = (
  claimed: CoachBotProvisioningRepo.Provisioning,
  options: { readonly recordFails?: boolean } = {},
): RepoStub => {
  const recorded: Array<{ readonly attemptId: string; readonly promptMessageId: number }> = []
  const completed: Array<string> = []
  const layer = Layer.succeed(
    CoachBotProvisioningRepo.Service,
    CoachBotProvisioningRepo.Service.of({
      prepare: unsupported,
      claim: () => Effect.succeed(claimed),
      recordPrompt: (attemptId, promptMessageId) => {
        if (options.recordFails === true) {
          return Effect.fail(
            new QueryFailed({
              operation: "provisioning.recordPrompt",
              cause: new Error("connection refused"),
            }),
          )
        }
        recorded.push({ attemptId, promptMessageId })
        return Effect.void
      },
      ingestCandidate: unsupported,
      findCandidateByBotId: unsupported,
      complete: (input) => {
        completed.push(input.provisioningId)
        return Effect.succeed(installation)
      },
      findByBotId: (telegramBotId) =>
        Effect.fail(new CoachBotProvisioningRepo.InstallationNotFound({ key: telegramBotId })),
      findByWorkspace: unsupported,
      workspaceProfile: unsupported,
      rotate: unsupported,
      pendingNotifications: unsupported,
      markNotificationDelivered: unsupported,
      deferNotification: unsupported,
    }),
  )
  return { layer, recorded, completed }
}

interface TelegramCall {
  readonly method: string
  readonly body: Record<string, unknown>
}

interface TelegramStub {
  readonly fetch: typeof globalThis.fetch
  readonly calls: Array<TelegramCall>
}

/** Every Telegram method, with the body it was called with; `failing` 401s. */
const telegramStub = (failing: ReadonlyArray<string> = []): TelegramStub => {
  const calls: Array<TelegramCall> = []
  let nextMessageId = 500
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const method = new URL(input.toString()).pathname.split("/").at(-1) ?? ""
    const raw = init?.body
    calls.push({
      method,
      body: typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : {},
    })
    if (failing.includes(method)) {
      return Response.json(
        { ok: false, error_code: 400, description: "Bad Request" },
        { status: 400 },
      )
    }
    if (method === "sendMessage" || method === "editMessageText") {
      nextMessageId += 1
      return Response.json({ ok: true, result: { message_id: nextMessageId } })
    }
    if (method === "getManagedBotToken") {
      return Response.json({ ok: true, result: MANAGED_BOT_TOKEN })
    }
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

const bodyOf = (telegram: TelegramStub, method: string): Record<string, unknown> | undefined =>
  telegram.calls.find((call) => call.method === method)?.body

describe("the creation deep link", () => {
  it("carries the manager bot and the suggested username, and nothing else", () => {
    expect(createBotLink("PraximoManagerBot", "ada_coaching_bot")).toBe(
      "https://t.me/newbot/PraximoManagerBot/ada_coaching_bot",
    )
  })
})

describe("offering bot creation", () => {
  const offer = (repo: RepoStub, telegram: TelegramStub, setup = attempt()) =>
    offerBotCreation(env, setup, telegram.fetch).pipe(Effect.provide(repo.layer))

  it.effect("sends the link on an inline url button, and records the message", () =>
    Effect.gen(function* () {
      const repo = repoStub(attempt())
      const telegram = telegramStub()

      const messageId = yield* offer(repo, telegram)

      // Only a send: there was no earlier prompt to disarm.
      expect(telegram.calls.map((call) => call.method)).toEqual(["sendMessage"])
      const sent = bodyOf(telegram, "sendMessage")
      expect(sent?.text).toBe(messages("ru").invitationReserved("Ada Coaching"))
      // An inline `url` button is the most basic inline type there is, and the
      // reason this replaces the reply keyboard iOS refuses to serve.
      expect(sent?.reply_markup).toEqual({
        inline_keyboard: [
          [
            {
              text: messages("ru").createBotButton,
              url: "https://t.me/newbot/PraximoManagerBot/ada_coaching_bot",
            },
          ],
        ],
      })
      // The message id is the only handle on this prompt; without it there is
      // nothing to disarm later and nothing to confirm in place.
      expect(repo.recorded).toEqual([
        { attemptId: "cbp_test_800000101", promptMessageId: messageId },
      ])
    }),
  )

  it.effect("disarms the previous prompt before a second button can be live", () =>
    Effect.gen(function* () {
      const repo = repoStub(attempt())
      const telegram = telegramStub()

      const messageId = yield* offer(repo, telegram, attempt({ promptMessageId: 401 }))

      // Order is the whole invariant: the old button is gone before the new one
      // exists, so two live buttons never coexist even for a moment.
      expect(telegram.calls.map((call) => call.method)).toEqual([
        "editMessageReplyMarkup",
        "sendMessage",
      ])
      const disarmed = bodyOf(telegram, "editMessageReplyMarkup")
      expect(disarmed?.message_id).toBe(401)
      expect(disarmed?.chat_id).toBe(coach)
      // Nothing but the keyboard is touched: the old text stays as the record of
      // what happened.
      expect(disarmed?.reply_markup).toBeUndefined()
      expect(disarmed?.text).toBeUndefined()
      expect(repo.recorded).toEqual([
        { attemptId: "cbp_test_800000101", promptMessageId: messageId },
      ])
    }),
  )

  it.effect("keeps the button the coach is looking at when recording it fails", () =>
    Effect.gen(function* () {
      const repo = repoStub(attempt(), { recordFails: true })
      const telegram = telegramStub()

      const messageId = yield* offer(repo, telegram, attempt({ promptMessageId: 401 }))

      // The `/start` succeeds and the coach gets a working button. What is given
      // up is the handle on it: a later `/start` will disarm the dead 401 and
      // leave two armed prompts, which the claim fence survives (#135). Failing
      // here instead would either take the working button away or — on the
      // redelivery a failure invites — hand them a second one.
      expect(telegram.calls.map((call) => call.method)).toEqual([
        "editMessageReplyMarkup",
        "sendMessage",
      ])
      expect(messageId).toBeGreaterThan(0)
      expect(repo.recorded).toEqual([])
    }),
  )

  it.effect("still offers creation when the previous prompt can no longer be edited", () =>
    Effect.gen(function* () {
      const repo = repoStub(attempt())
      // The 48-hour edit window lapsed, or the coach deleted the message.
      const telegram = telegramStub(["editMessageReplyMarkup"])

      const messageId = yield* offer(repo, telegram, attempt({ promptMessageId: 401 }))

      expect(telegram.calls.map((call) => call.method)).toEqual([
        "editMessageReplyMarkup",
        "sendMessage",
      ])
      expect(repo.recorded).toEqual([
        { attemptId: "cbp_test_800000101", promptMessageId: messageId },
      ])
    }),
  )
})

describe("activation and the prompt", () => {
  const provision = (repo: RepoStub, telegram: TelegramStub) =>
    provisionManagedBot(env, user, managedBot, "https://bot.praximo.test", telegram.fetch).pipe(
      Effect.provide(Layer.mergeAll(repo.layer, credentialLayer)),
    )

  it.effect("edits the prompt in place: keyboard gone, text confirms the bot", () =>
    Effect.gen(function* () {
      const repo = repoStub(attempt({ status: "configuring", promptMessageId: 401 }))
      const telegram = telegramStub()

      const outcome = yield* provision(repo, telegram)

      expect(outcome).toEqual({ _tag: "Connected", installation })
      expect(repo.completed).toEqual(["cbp_test_800000101"])
      const settled = bodyOf(telegram, "editMessageText")
      expect(settled?.message_id).toBe(401)
      expect(settled?.chat_id).toBe(coach)
      // Edited, never deleted — the coach is looking at this very message
      // expecting confirmation.
      expect(telegram.calls.map((call) => call.method)).not.toContain("deleteMessage")
      expect(settled?.text).toBe(messages("ru").promptConnected(MANAGED_BOT_USERNAME))
      // Omitting `reply_markup` is what takes the button off.
      expect(settled?.reply_markup).toBeUndefined()
    }),
  )

  it.effect("does not fail provisioning when the prompt can no longer be edited", () =>
    Effect.gen(function* () {
      const repo = repoStub(attempt({ status: "configuring", promptMessageId: 401 }))
      const telegram = telegramStub(["editMessageText"])

      const outcome = yield* provision(repo, telegram)

      // The bot is connected the moment the transaction commits; a refused edit
      // cannot undo that.
      expect(outcome).toEqual({ _tag: "Connected", installation })
      expect(repo.completed).toEqual(["cbp_test_800000101"])
    }),
  )

  it.effect("leaves the button armed when configuration fails part-way", () =>
    Effect.gen(function* () {
      const repo = repoStub(attempt({ status: "configuring", promptMessageId: 401 }))
      const telegram = telegramStub(["setChatMenuButton"])

      const failure = yield* Effect.flip(provision(repo, telegram))

      expect(failure).toMatchObject({
        _tag: "BotWorker.TelegramSetupFailed",
        operation: "setChatMenuButton",
      })
      // The workspace is unconnected on purpose and the coach resumes by tapping
      // again — disarming here would strand them.
      expect(repo.completed).toEqual([])
      expect(telegram.calls.map((call) => call.method)).not.toContain("editMessageText")
    }),
  )

  it.effect("has nothing to settle for an attempt that never recorded a prompt", () =>
    Effect.gen(function* () {
      const repo = repoStub(attempt({ status: "configuring" }))
      const telegram = telegramStub()

      const outcome = yield* provision(repo, telegram)

      expect(outcome).toEqual({ _tag: "Connected", installation })
      expect(telegram.calls.map((call) => call.method)).not.toContain("editMessageText")
    }),
  )
})
