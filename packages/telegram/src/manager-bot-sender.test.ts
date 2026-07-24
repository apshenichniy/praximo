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
      prepareManagerInlineInvite: async () =>
        ManagerBotSender.PrepareRpcResult.cases.Prepared.make({ id: "prep" }),
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
      prepareManagerInlineInvite: async () =>
        ManagerBotSender.PrepareRpcResult.cases.Prepared.make({ id: "prep" }),
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
      prepareManagerInlineInvite: async () => ({ _tag: "Unexpected" }),
    }

    return Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const error = yield* Effect.flip(sender.sendText(recipient, "Forward this invitation"))

      expect(error).toEqual(new ManagerBotSender.SendFailed({ recipient, category: "unknown" }))
    }).pipe(Effect.provide(ManagerBotSender.rpcLayer(client)))
  })
})

const invite: ManagerBotSender.InlineInvite = {
  title: "Praximo invite",
  text: "Forward this invitation\nhttps://t.me/praxi_bot?start=ws_ADA23456",
  buttonText: "Start onboarding",
  buttonUrl: "https://t.me/praxi_bot?start=ws_ADA23456",
}

describe("ManagerBotSender.prepareInlineInvite", () => {
  it.effect("records prepared invites through the test layer", () =>
    Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const prepared = yield* sender.prepareInlineInvite(recipient, invite)

      const stub = yield* ManagerBotSender.TestService
      expect(prepared.id.length).toBeGreaterThan(0)
      expect(yield* stub.prepared()).toEqual([{ recipient, invite }])
    }).pipe(Effect.provide(ManagerBotSender.testLayer)),
  )

  it.effect("fails exactly the next test-layer prepare", () =>
    Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const stub = yield* ManagerBotSender.TestService
      const failure = new ManagerBotSender.PrepareFailed({ recipient, category: "bot-api" })

      yield* stub.failNextPrepare(failure)
      const failed = yield* Effect.flip(sender.prepareInlineInvite(recipient, invite))
      yield* sender.prepareInlineInvite(recipient, invite)

      expect(failed).toEqual(failure)
      expect(yield* stub.prepared()).toEqual([{ recipient, invite }])
    }).pipe(Effect.provide(ManagerBotSender.testLayer)),
  )

  it.effect("saves the prepared inline message through Telegram with a URL button", () => {
    const requests: Array<{ readonly url: string; readonly body: unknown }> = []
    const fakeFetch: typeof fetch = async (input, init) => {
      requests.push({ url: input.toString(), body: JSON.parse(String(init?.body)) })
      return Response.json({
        ok: true,
        result: { id: "prep_abc123", expiration_date: 1784812345 },
      })
    }

    return Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const prepared = yield* sender.prepareInlineInvite(recipient, invite)

      expect(prepared).toEqual({ id: "prep_abc123" })
      expect(requests).toEqual([
        {
          url: "https://api.telegram.org/bottest-token/savePreparedInlineMessage",
          body: {
            user_id: 123456789,
            allow_user_chats: true,
            result: {
              type: "article",
              id: "invite",
              title: invite.title,
              input_message_content: { message_text: invite.text },
              reply_markup: {
                inline_keyboard: [[{ text: invite.buttonText, url: invite.buttonUrl }]],
              },
            },
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

  it.effect("classifies a Telegram rejection without leaking the deep link", () => {
    return Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const error = yield* Effect.flip(sender.prepareInlineInvite(recipient, invite))

      expect(error).toEqual(new ManagerBotSender.PrepareFailed({ recipient, category: "bot-api" }))
      expect(JSON.stringify(error)).not.toContain("ws_ADA23456")
    }).pipe(
      Effect.provide(ManagerBotSender.layerWithFetch(telegramRejectedFetch)),
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ MANAGER_BOT_TOKEN: "test-token" })),
      ),
    )
  })

  it.effect("maps RPC acceptance to the prepared id", () => {
    const client: ManagerBotSender.RpcClient = {
      sendManagerText: async () => ManagerBotSender.RpcResult.cases.Sent.make({}),
      prepareManagerInlineInvite: async () =>
        ManagerBotSender.PrepareRpcResult.cases.Prepared.make({ id: "prep_rpc" }),
    }

    return Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const prepared = yield* sender.prepareInlineInvite(recipient, invite)

      expect(prepared).toEqual({ id: "prep_rpc" })
    }).pipe(Effect.provide(ManagerBotSender.rpcLayer(client)))
  })

  it.effect("maps tagged RPC failures back to PrepareFailed", () => {
    const client: ManagerBotSender.RpcClient = {
      sendManagerText: async () => ManagerBotSender.RpcResult.cases.Sent.make({}),
      prepareManagerInlineInvite: async () =>
        ManagerBotSender.PrepareRpcResult.cases.Failed.make({ recipient, category: "transport" }),
    }

    return Effect.gen(function* () {
      const sender = yield* ManagerBotSender.Service
      const error = yield* Effect.flip(sender.prepareInlineInvite(recipient, invite))

      expect(error).toEqual(
        new ManagerBotSender.PrepareFailed({ recipient, category: "transport" }),
      )
    }).pipe(Effect.provide(ManagerBotSender.rpcLayer(client)))
  })
})
