import { describe, expect, it } from "@effect/vitest"
import { TelegramId } from "@praximo/domain"
import { ManagerBotSender } from "@praximo/telegram"
import { Effect } from "effect"
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
}

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
