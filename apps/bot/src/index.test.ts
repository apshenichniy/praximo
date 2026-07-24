import { describe, expect, it } from "@effect/vitest"
import { TelegramId } from "@praximo/domain"
import { ManagerBotSender } from "@praximo/telegram"
import { Effect } from "effect"
import { managedBotSuggestions } from "./provisioning.ts"
import { handleRequest, sendManagerText } from "./runtime.ts"

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
  COACH_MINI_APP_URL: "https://stage.praximo.io/",
  UPLOADS: {} as R2Bucket,
}

describe("bot worker", () => {
  it("derives Telegram-safe managed bot suggestions from the workspace name", () => {
    expect(managedBotSuggestions("Áda & Partners")).toEqual({
      name: "Áda & Partners",
      username: "ada_partners_bot",
    })
    expect(managedBotSuggestions("123")).toEqual({
      name: "123",
      username: "coach_123_bot",
    })
  })

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
})
