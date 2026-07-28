import { describe, expect, it } from "@effect/vitest"
import { TelegramId, WorkspaceId } from "@praximo/domain"
import { ManagerBotSender } from "@praximo/telegram"
import { Effect } from "effect"
import { suggestedBotUsername } from "./provisioning.ts"
import { handleRequest, prepareManagerInlineInvite, sendManagerText } from "./runtime.ts"

// The health route builds WorkspaceRepo over the real Neon connection (#47),
// which reads DATABASE_URL from the app's ConfigProvider over the Worker env. On
// the deployed dev worker that's the alchemy secret binding; here a well-formed
// dummy lets the client construct without ever opening a connection (health runs
// no query).
const env = {
  DATABASE_URL:
    "postgresql://user:pass@ep-dummy-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require",
  MANAGER_BOT_TOKEN: "test-token",
  MANAGER_BOT_USERNAME: "PraximoManagerBot",
  MANAGER_BOT_WEBHOOK_SECRET: "test-webhook-secret",
  COACH_BOT_CREDENTIAL_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: "branding/default-coach-avatar.jpg",
  COACH_MINI_APP_URL: "https://coach.praximo.io/",
  CLIENT_APP_URL: "https://me.praximo.io",
  UPLOADS: {} as R2Bucket,
}

/**
 * The suggested coach-bot username (#147). It rides in a URL the coach taps
 * (#134), so both halves of its job are load-bearing: it has to be *plausible*
 * from the workspace name, and it has to be one Telegram will actually accept
 * and probably has free.
 */
describe("the suggested coach bot username", () => {
  const workspace = WorkspaceId.make("ws_019f92510000700080000000")
  const other = WorkspaceId.make("ws_019f92510000700080000001")

  it("reads as the workspace name, with a tag that keeps it off a taken one", () => {
    const suggestion = suggestedBotUsername("Áda & Partners", workspace)

    // Recognisably theirs: accents folded, punctuation collapsed to one `_`.
    expect(suggestion).toMatch(/^ada_partners_[0-9a-z]{4}_bot$/)
    // The tag is what a bare `ada_partners_bot` — long since registered by
    // somebody — does not have.
    expect(suggestion).not.toBe("ada_partners_bot")
  })

  it("is the same on every /start, and different per workspace", () => {
    // `/start` is a resume path and re-sends the prompt (#134): a coach who
    // reopens their link must not be handed a new username each time.
    expect(suggestedBotUsername("Ada Coaching", workspace)).toBe(
      suggestedBotUsername("Ada Coaching", workspace),
    )
    // Two workspaces that share a name are the collision we *can* prevent.
    expect(suggestedBotUsername("Demo", workspace)).not.toBe(suggestedBotUsername("Demo", other))
  })

  it("stays inside what Telegram accepts, at every edge", () => {
    const names = [
      "Áda & Partners",
      "123",
      "",
      "   ",
      "!!!",
      "Ada Coaching",
      "Demo",
      "Ada Partners Consulting Grp abc",
      // Cuts exactly on a separator (`northern_star_coaching_`) — the shape that
      // used to emit a doubled one, and the reason the strip runs after the cut.
      // Which name lands there depends on the budget, so this one is load-bearing
      // and a change to `room` may move it: deleting the post-cut strip must fail
      // this test.
      "Northern Star Coaching Collective With A Very Long Name",
      // Every character is dropped by the ASCII fold.
      "日本語のワークスペース",
      // Already carries the separator the fold would produce, at both ends.
      "_Ada_Coaching_",
    ]

    for (const name of names) {
      const suggestion = suggestedBotUsername(name, workspace)

      // 5–32 characters, `[A-Za-z0-9_]`, opens with a letter, ends in `bot`.
      expect(suggestion).toMatch(/^[a-z][a-z0-9_]{3,28}_bot$/)
      expect(suggestion.length).toBeLessThanOrEqual(32)
      expect(suggestion.length).toBeGreaterThanOrEqual(5)
      // A doubled separator reads as a typo in a URL the coach is looking at,
      // and Telegram's own username validation may refuse it outright.
      expect(suggestion).not.toContain("__")
    }
  })

  it("keeps a workspace named in a script Telegram has no letters for", () => {
    // Nothing survives the ASCII fold, so the stem cannot come from the name —
    // but the suggestion still has to be a valid, workspace-specific username.
    const suggestion = suggestedBotUsername("日本語のワークスペース", workspace)

    expect(suggestion).toMatch(/^praximo_coach_[0-9a-z]{4}_bot$/)
    expect(suggestion).not.toBe(suggestedBotUsername("日本語のワークスペース", other))
  })
})

describe("bot worker", () => {
  it("boots its runtime and answers the health route", async () => {
    const response = await handleRequest(new Request("https://bot.praximo.test/health"), env)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ app: "bot", status: "ok" })
  })

  it("404s off the health route", async () => {
    const response = await handleRequest(new Request("https://bot.praximo.test/"), env)

    expect(response.status).toBe(404)
  })

  it("rejects manager webhook requests without the configured secret", async () => {
    const response = await handleRequest(
      new Request("https://bot.praximo.test/telegram/manager", {
        method: "POST",
        body: JSON.stringify({ update_id: 1 }),
      }),
      env,
    )

    expect(response.status).toBe(401)
  })

  it("initializes the manager bot before dispatching a webhook update", async () => {
    const methods: Array<string> = []
    const telegramFetch: typeof fetch = async (input) => {
      const method = new URL(input.toString()).pathname.split("/").at(-1) ?? ""
      methods.push(method)
      if (method !== "getMe") throw new Error(`unexpected Telegram method ${method}`)
      return Response.json({
        ok: true,
        result: {
          id: 5100,
          is_bot: true,
          first_name: "Praximo Manager",
          username: "PraximoManagerBot",
          can_join_groups: false,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
        },
      })
    }
    const response = await handleRequest(
      new Request("https://bot.praximo.test/telegram/manager", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": env.MANAGER_BOT_WEBHOOK_SECRET },
        body: JSON.stringify({
          update_id: 51,
          message: {
            message_id: 1,
            date: 0,
            chat: { id: 123456789, type: "private" },
            from: { id: 123456789, is_bot: false, first_name: "Ada" },
            text: "hello",
          },
        }),
      }),
      env,
      telegramFetch,
    )

    expect(response.status).toBe(200)
    expect(methods).toEqual(["getMe"])
  })

  it.effect("maps a successful manager-bot send to the RPC contract", () =>
    Effect.gen(function* () {
      const recipient = TelegramId.make("123456789")
      const text = "Forward this invitation"
      const result = yield* sendManagerText(recipient, text)
      const stub = yield* ManagerBotSender.TestService

      expect(result).toEqual(ManagerBotSender.RpcResult.cases.Sent.make({}))
      expect(yield* stub.sent()).toEqual([{ recipient, text }])
    }).pipe(Effect.provide(ManagerBotSender.testLayer)),
  )

  it.effect("maps typed manager-bot failures to the RPC contract", () =>
    Effect.gen(function* () {
      const recipient = TelegramId.make("123456789")
      const stub = yield* ManagerBotSender.TestService
      yield* stub.failNextSend(
        new ManagerBotSender.SendFailed({
          recipient,
          category: "transport",
        }),
      )

      const result = yield* sendManagerText(recipient, "Forward this invitation")

      expect(result).toEqual(
        ManagerBotSender.RpcResult.cases.Failed.make({
          recipient,
          category: "transport",
        }),
      )
    }).pipe(Effect.provide(ManagerBotSender.testLayer)),
  )

  const invite: ManagerBotSender.InlineInvite = {
    title: "Praximo invite",
    text: "Forward this invitation\nhttps://t.me/PraximoManagerBot?start=ws_ADA23456",
    buttonText: "Start onboarding",
    buttonUrl: "https://t.me/PraximoManagerBot?start=ws_ADA23456",
  }

  it.effect("maps a prepared inline invite to the RPC contract", () =>
    Effect.gen(function* () {
      const recipient = TelegramId.make("123456789")
      const result = yield* prepareManagerInlineInvite(recipient, invite)
      const stub = yield* ManagerBotSender.TestService

      expect(result).toEqual(
        ManagerBotSender.PrepareRpcResult.cases.Prepared.make({ id: "prepared-message-0" }),
      )
      expect(yield* stub.prepared()).toEqual([{ recipient, invite }])
    }).pipe(Effect.provide(ManagerBotSender.testLayer)),
  )

  it.effect("maps typed prepare failures to the RPC contract", () =>
    Effect.gen(function* () {
      const recipient = TelegramId.make("123456789")
      const stub = yield* ManagerBotSender.TestService
      yield* stub.failNextPrepare(
        new ManagerBotSender.PrepareFailed({ recipient, category: "bot-api" }),
      )

      const result = yield* prepareManagerInlineInvite(recipient, invite)

      expect(result).toEqual(
        ManagerBotSender.PrepareRpcResult.cases.Failed.make({ recipient, category: "bot-api" }),
      )
    }).pipe(Effect.provide(ManagerBotSender.testLayer)),
  )
})
