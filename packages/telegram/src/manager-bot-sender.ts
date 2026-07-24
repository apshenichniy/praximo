import { TelegramId } from "@praximo/domain"
import { Api, GrammyError, HttpError } from "grammy"
import { Config, Context, Effect, Layer, Option, Redacted, Ref, Schema } from "effect"

export const FailureCategory = Schema.Literals(["bot-api", "transport", "undeliverable", "unknown"])
export type FailureCategory = typeof FailureCategory.Type

/**
 * A bot-authored invite prepared for the manager to forward into a coach's chat
 * (Bot API 8.0 `savePreparedInlineMessage`). The manager then shares it via the
 * Mini App's native chat picker, so the coach receives a message the *bot*
 * authored — carrying a tappable onboarding button, not the manager's own text.
 */
export interface InlineInvite {
  /** Result title — required by Telegram, not shown in the forwarded message. */
  readonly title: string
  /** The forwardable message body. */
  readonly text: string
  /** Inline URL button label. */
  readonly buttonText: string
  /** Inline URL button target: the one-time onboarding deep link. */
  readonly buttonUrl: string
}

/** The short-lived prepared message; its id is handed to `WebApp.shareMessage`. */
export interface PreparedInvite {
  readonly id: string
}

export interface Interface {
  readonly sendText: (recipient: TelegramId, text: string) => Effect.Effect<void, SendFailed>
  readonly prepareInlineInvite: (
    recipient: TelegramId,
    invite: InlineInvite,
  ) => Effect.Effect<PreparedInvite, PrepareFailed>
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

export class PrepareFailed extends Schema.TaggedErrorClass<PrepareFailed>()(
  "ManagerBotSender.PrepareFailed",
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

export const PrepareRpcResult = Schema.TaggedUnion({
  Prepared: { id: Schema.String },
  Failed: {
    recipient: TelegramId,
    category: FailureCategory,
  },
})
export type PrepareRpcResult = typeof PrepareRpcResult.Type

export interface RpcClient {
  readonly sendManagerText: (recipient: TelegramId, text: string) => Promise<unknown>
  readonly prepareManagerInlineInvite: (
    recipient: TelegramId,
    invite: InlineInvite,
  ) => Promise<unknown>
}

/**
 * Map a grammY failure to a coarse category without carrying its cause — the
 * cause can embed the bot token or the message body, neither of which may leak
 * into a typed error the surface serializes.
 */
const classifyFailure = (cause: unknown): FailureCategory =>
  cause instanceof GrammyError
    ? cause.error_code === 403 || cause.description.toLocaleLowerCase().includes("chat not found")
      ? "undeliverable"
      : "bot-api"
    : cause instanceof HttpError
      ? "transport"
      : "unknown"

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
          catch: (cause) => new SendFailed({ recipient, category: classifyFailure(cause) }),
        })
      })

      const prepareInlineInvite = Effect.fn("ManagerBotSender.prepareInlineInvite")(function* (
        recipient: TelegramId,
        invite: InlineInvite,
      ) {
        const prepared = yield* Effect.tryPromise({
          try: () =>
            // The manager is both the target user and the eventual sender, so the
            // message need only be sharable into a user's private chat.
            api.savePreparedInlineMessage(
              Number(recipient),
              {
                type: "article",
                id: "invite",
                title: invite.title,
                input_message_content: { message_text: invite.text },
                reply_markup: {
                  inline_keyboard: [[{ text: invite.buttonText, url: invite.buttonUrl }]],
                },
              },
              { allow_user_chats: true },
            ),
          catch: (cause) => new PrepareFailed({ recipient, category: classifyFailure(cause) }),
        })
        return { id: prepared.id } satisfies PreparedInvite
      })

      return Service.of({ sendText, prepareInlineInvite })
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
      prepareInlineInvite: Effect.fn("ManagerBotSender.Rpc.prepareInlineInvite")(function* (
        recipient: TelegramId,
        invite: InlineInvite,
      ) {
        const result = yield* Effect.tryPromise({
          try: () => client.prepareManagerInlineInvite(recipient, invite),
          catch: () => new PrepareFailed({ recipient, category: "unknown" }),
        })
        const decoded = yield* Schema.decodeUnknownEffect(PrepareRpcResult)(result).pipe(
          Effect.mapError(() => new PrepareFailed({ recipient, category: "unknown" })),
        )

        if (PrepareRpcResult.guards.Failed(decoded)) {
          return yield* Effect.fail(
            new PrepareFailed({
              recipient: decoded.recipient,
              category: decoded.category,
            }),
          )
        }
        return { id: decoded.id } satisfies PreparedInvite
      }),
    }),
  )

export interface SentMessage {
  readonly recipient: TelegramId
  readonly text: string
}

export interface PreparedInviteRecord {
  readonly recipient: TelegramId
  readonly invite: InlineInvite
}

export interface TestInterface extends Interface {
  readonly sent: () => Effect.Effect<ReadonlyArray<SentMessage>>
  readonly failNextSend: (failure: SendFailed) => Effect.Effect<void>
  readonly prepared: () => Effect.Effect<ReadonlyArray<PreparedInviteRecord>>
  readonly failNextPrepare: (failure: PrepareFailed) => Effect.Effect<void>
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@praximo/telegram/ManagerBotSender/Test",
) {}

export const testLayer = Layer.effectContext(
  Effect.gen(function* () {
    const messages = yield* Ref.make<ReadonlyArray<SentMessage>>([])
    const nextFailure = yield* Ref.make<Option.Option<SendFailed>>(Option.none())
    const preparedInvites = yield* Ref.make<ReadonlyArray<PreparedInviteRecord>>([])
    const nextPrepareFailure = yield* Ref.make<Option.Option<PrepareFailed>>(Option.none())

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

    const prepareInlineInvite = Effect.fn("ManagerBotSender.Test.prepareInlineInvite")(function* (
      recipient: TelegramId,
      invite: InlineInvite,
    ) {
      const failure = yield* Ref.getAndSet(nextPrepareFailure, Option.none())
      if (Option.isSome(failure)) return yield* Effect.fail(failure.value)
      const previous = yield* Ref.getAndUpdate(preparedInvites, (prepared) => [
        ...prepared,
        { recipient, invite },
      ])
      return { id: `prepared-message-${previous.length}` } satisfies PreparedInvite
    })

    const prepared = Effect.fn("ManagerBotSender.Test.prepared")(function* () {
      return yield* Ref.get(preparedInvites)
    })

    const failNextPrepare = Effect.fn("ManagerBotSender.Test.failNextPrepare")(function* (
      failure: PrepareFailed,
    ) {
      yield* Ref.set(nextPrepareFailure, Option.some(failure))
    })

    const impl = TestService.of({
      sendText,
      sent,
      failNextSend,
      prepareInlineInvite,
      prepared,
      failNextPrepare,
    })

    return Context.make(Service, impl).pipe(Context.add(TestService, impl))
  }),
)

export * as ManagerBotSender from "./manager-bot-sender.ts"
