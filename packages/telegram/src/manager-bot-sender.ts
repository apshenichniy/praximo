import { TelegramId } from "@praximo/domain"
import { Api, GrammyError, HttpError } from "grammy"
import { Config, Context, Effect, Layer, Option, Redacted, Ref, Schema } from "effect"

export const FailureCategory = Schema.Literals(["bot-api", "transport", "unknown"])
export type FailureCategory = typeof FailureCategory.Type

export interface Interface {
  readonly sendText: (recipient: TelegramId, text: string) => Effect.Effect<void, SendFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/telegram/ManagerBotSender",
) {}

export class SendFailed extends Schema.TaggedErrorClass<SendFailed>()(
  "ManagerBotSender.SendFailed",
  {
    recipient: TelegramId,
    category: FailureCategory,
  },
) {}

export const RpcResult = Schema.TaggedUnion({
  Sent: {},
  Failed: {
    recipient: TelegramId,
    category: FailureCategory,
  },
})
export type RpcResult = typeof RpcResult.Type

export interface RpcClient {
  readonly sendManagerText: (recipient: TelegramId, text: string) => Promise<unknown>
}

const makeLayer = (fetch?: typeof globalThis.fetch) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const token = yield* Config.redacted("MANAGER_BOT_TOKEN")
      const api = new Api(Redacted.value(token), fetch === undefined ? undefined : { fetch })

      const sendText = Effect.fn("ManagerBotSender.sendText")(function* (
        recipient: TelegramId,
        text: string,
      ) {
        yield* Effect.tryPromise({
          try: () => api.sendMessage(recipient, text),
          catch: (cause) =>
            new SendFailed({
              recipient,
              category:
                cause instanceof GrammyError
                  ? "bot-api"
                  : cause instanceof HttpError
                    ? "transport"
                    : "unknown",
            }),
        })
      })

      return Service.of({ sendText })
    }),
  )

export const layer = makeLayer()

export const layerWithFetch = (fetch: typeof globalThis.fetch) => makeLayer(fetch)

export const rpcLayer = (client: RpcClient) =>
  Layer.succeed(
    Service,
    Service.of({
      sendText: Effect.fn("ManagerBotSender.Rpc.sendText")(function* (
        recipient: TelegramId,
        text: string,
      ) {
        const result = yield* Effect.tryPromise({
          try: () => client.sendManagerText(recipient, text),
          catch: () => new SendFailed({ recipient, category: "unknown" }),
        })
        const decoded = yield* Schema.decodeUnknownEffect(RpcResult)(result).pipe(
          Effect.mapError(() => new SendFailed({ recipient, category: "unknown" })),
        )

        if (RpcResult.guards.Failed(decoded)) {
          return yield* Effect.fail(
            new SendFailed({
              recipient: decoded.recipient,
              category: decoded.category,
            }),
          )
        }
      }),
    }),
  )

export interface SentMessage {
  readonly recipient: TelegramId
  readonly text: string
}

export interface TestInterface extends Interface {
  readonly sent: () => Effect.Effect<ReadonlyArray<SentMessage>>
  readonly failNextSend: (failure: SendFailed) => Effect.Effect<void>
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@praximo/telegram/ManagerBotSender/Test",
) {}

export const testLayer = Layer.effectContext(
  Effect.gen(function* () {
    const messages = yield* Ref.make<ReadonlyArray<SentMessage>>([])
    const nextFailure = yield* Ref.make<Option.Option<SendFailed>>(Option.none())

    const sendText = Effect.fn("ManagerBotSender.Test.sendText")(function* (
      recipient: TelegramId,
      text: string,
    ) {
      const failure = yield* Ref.getAndSet(nextFailure, Option.none())
      if (Option.isSome(failure)) return yield* Effect.fail(failure.value)
      yield* Ref.update(messages, (sent) => [...sent, { recipient, text }])
    })

    const sent = Effect.fn("ManagerBotSender.Test.sent")(function* () {
      return yield* Ref.get(messages)
    })

    const failNextSend = Effect.fn("ManagerBotSender.Test.failNextSend")(function* (
      failure: SendFailed,
    ) {
      yield* Ref.set(nextFailure, Option.some(failure))
    })

    const impl = TestService.of({ sendText, sent, failNextSend })

    return Context.make(Service, impl).pipe(Context.add(TestService, impl))
  }),
)

export * as ManagerBotSender from "./manager-bot-sender.ts"
