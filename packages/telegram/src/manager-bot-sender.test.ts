import { describe, expect, it } from "@effect/vitest"
import { TelegramId } from "@praximo/domain"
import { ConfigProvider, Effect } from "effect"
import { ManagerBotSender } from "./manager-bot-sender.ts"

const recipient = TelegramId.make("123456789")

const telegramRejectedFetch: typeof fetch = async () =>
  Response.json({
    ok: false,
    error_code: 400,
    description: "Bad Request: rejected secret-message",
  })

const unavailableFetch: typeof fetch = async () => {
  throw new Error("network exposed test-token and secret-message")
}

describe("ManagerBotSender", () => {
  it.effect("records text sent through the test layer", () =>
    Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      yield* sender.sendText(recipient, "Forward this invitation")

      const stub = yield* ManagerBotSender.TestService
      const sent = yield* stub.sent()

      expect(sent).toEqual([{ recipient, text: "Forward this invitation" }])
    }).pipe(Effect.provide(ManagerBotSender.testLayer)),
  )

  it.effect("fails exactly the next test-layer send", () =>
    Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const stub = yield* ManagerBotSender.TestService
      const failure = new ManagerBotSender.SendFailed({
        recipient,
        category: "transport",
      })

      yield* stub.failNextSend(failure)
      const failed = yield* Effect.flip(sender.sendText(recipient, "first"))
      yield* sender.sendText(recipient, "second")

      expect(failed).toEqual(failure)
      expect(yield* stub.sent()).toEqual([{ recipient, text: "second" }])
    }).pipe(Effect.provide(ManagerBotSender.testLayer)),
  )

  it.effect("sends text through Telegram without exposing grammY details", () => {
    const requests: Array<{ readonly url: string; readonly body: unknown }> = []
    const fakeFetch: typeof fetch = async (input, init) => {
      requests.push({
        url: input.toString(),
        body: JSON.parse(String(init?.body)),
      })
      return Response.json({
        ok: true,
        result: {
          message_id: 1,
          date: 0,
          chat: { id: 123456789, type: "private" },
          text: "Forward this invitation",
        },
      })
    }

    return Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const result = yield* sender.sendText(recipient, "Forward this invitation")

      expect(result).toBeUndefined()
      expect(requests).toEqual([
        {
          url: "https://api.telegram.org/bottest-token/sendMessage",
          body: {
            chat_id: "123456789",
            text: "Forward this invitation",
          },
        },
      ])
    }).pipe(
      Effect.provide(ManagerBotSender.layerWithFetch(fakeFetch)),
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ MANAGER_BOT_TOKEN: "test-token" })),
      ),
    )
  })

  it.effect("classifies Telegram rejections without leaking sensitive details", () => {
    return Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const error = yield* Effect.flip(sender.sendText(recipient, "secret-message"))

      expect(error).toEqual(new ManagerBotSender.SendFailed({ recipient, category: "bot-api" }))
      expect(JSON.stringify(error)).not.toContain("secret-message")
      expect(JSON.stringify(error)).not.toContain("test-token")
    }).pipe(
      Effect.provide(ManagerBotSender.layerWithFetch(telegramRejectedFetch)),
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ MANAGER_BOT_TOKEN: "test-token" })),
      ),
    )
  })

  it.effect("classifies transport failures without leaking their causes", () =>
    Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const error = yield* Effect.flip(sender.sendText(recipient, "secret-message"))

      expect(error).toEqual(new ManagerBotSender.SendFailed({ recipient, category: "transport" }))
      expect(JSON.stringify(error)).not.toContain("secret-message")
      expect(JSON.stringify(error)).not.toContain("test-token")
    }).pipe(
      Effect.provide(ManagerBotSender.layerWithFetch(unavailableFetch)),
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ MANAGER_BOT_TOKEN: "test-token" })),
      ),
    ),
  )

  it.effect("maps RPC acceptance to the send seam", () => {
    const client: ManagerBotSender.RpcClient = {
      sendManagerText: async () => ManagerBotSender.RpcResult.cases.Sent.make({}),
    }

    return Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const result = yield* sender.sendText(recipient, "Forward this invitation")

      expect(result).toBeUndefined()
    }).pipe(Effect.provide(ManagerBotSender.rpcLayer(client)))
  })

  it.effect("maps tagged RPC failures back to SendFailed", () => {
    const client: ManagerBotSender.RpcClient = {
      sendManagerText: async () =>
        ManagerBotSender.RpcResult.cases.Failed.make({
          recipient,
          category: "bot-api",
        }),
    }

    return Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const error = yield* Effect.flip(sender.sendText(recipient, "Forward this invitation"))

      expect(error).toEqual(new ManagerBotSender.SendFailed({ recipient, category: "bot-api" }))
    }).pipe(Effect.provide(ManagerBotSender.rpcLayer(client)))
  })

  it.effect("rejects malformed RPC results as unknown failures", () => {
    const client: ManagerBotSender.RpcClient = {
      sendManagerText: async () => ({ _tag: "Unexpected" }),
    }

    return Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const error = yield* Effect.flip(sender.sendText(recipient, "Forward this invitation"))

      expect(error).toEqual(new ManagerBotSender.SendFailed({ recipient, category: "unknown" }))
    }).pipe(Effect.provide(ManagerBotSender.rpcLayer(client)))
  })
})
