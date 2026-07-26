import { WorkspaceId } from "@praximo/domain"
import { Clock, Context, Effect, Layer, Option, Ref, Schema } from "effect"

/**
 * Resolves a workspace's dedicated bot and sends messages through it.
 *
 * This is the reference implementation of the project's Effect module style
 * (ADR 0002): file-local `Interface` / `Service` / `layer` roles, errors next to
 * the owning service, operations wrapped in `Effect.fn`, and a canonical module
 * namespace self-exported at the bottom of the file.
 */
/**
 * What a message may carry besides its words.
 *
 * Deliberately narrow: an inline button and a parse mode, which is exactly what
 * the client-accepted push needs (#56) — the coach is told a client is in, and
 * the same message opens the Mini App on that client's route. Anything richer
 * belongs to a sender that knows about chats and recipients, which this seam
 * does not.
 */
export interface SendOptions {
  readonly parseMode?: "HTML"
  readonly button?: {
    readonly text: string
    /** Opens the Mini App — a `web_app` button, not a URL. */
    readonly webAppUrl: string
  }
}

/**
 * A card the workspace's own bot authors for its coach to forward (Bot API 8.0
 * `savePreparedInlineMessage`, #179).
 *
 * The author has to be the coach's bot and no other: the client is being
 * introduced to their coach's assistant, and a message labelled "via @PraximoBot"
 * would introduce them to a platform instead (client-onboarding-auth.md
 * §Principles).
 */
export interface InviteCard {
  /** Result title — required by Telegram, not shown in the shared message. */
  readonly title: string
  /** The shareable message body. */
  readonly text: string
  /** Inline button label. */
  readonly buttonText: string
  /**
   * The button's target — a `t.me/<coach_bot>?start=inv_<token>` deep link.
   *
   * A `url` button and never a `web_app` one: Telegram does not allow `web_app`
   * buttons in inline messages, which is why this seam cannot reuse
   * {@link SendOptions}' button at all.
   */
  readonly buttonUrl: string
}

/** The short-lived prepared message; its id is handed to `WebApp.shareMessage`. */
export interface PreparedCard {
  readonly id: string
  /** Telegram's own `expiration_date`, read from the response rather than assumed. */
  readonly expiresAt: Date
}

export interface Interface {
  readonly send: (
    workspace: WorkspaceId,
    text: string,
    options?: SendOptions,
  ) => Effect.Effect<void, SendFailed>
  /**
   * Mint a card the workspace's coach can hand to Telegram's chat picker.
   *
   * The recipient is implied for the same reason `send`'s is: a workspace names
   * exactly one coach, and here that coach is also the *sender* Telegram binds
   * the prepared message to.
   */
  readonly prepareCard: (
    workspace: WorkspaceId,
    card: InviteCard,
  ) => Effect.Effect<PreparedCard, PrepareFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/telegram/BotRegistry",
) {}

export class SendFailed extends Schema.TaggedErrorClass<SendFailed>()("BotRegistry.SendFailed", {
  workspace: WorkspaceId,
  reason: Schema.String,
}) {}

export class PrepareFailed extends Schema.TaggedErrorClass<PrepareFailed>()(
  "BotRegistry.PrepareFailed",
  {
    workspace: WorkspaceId,
    reason: Schema.String,
  },
) {}

/**
 * What crosses the Worker boundary. The expiry travels as epoch milliseconds
 * because a service binding carries data, not `Date` semantics we would then
 * have to agree on twice.
 */
export const PrepareCardRpcResult = Schema.TaggedUnion({
  Prepared: { id: Schema.String, expiresAtMillis: Schema.Number },
  Failed: { workspace: WorkspaceId, reason: Schema.String },
})
export type PrepareCardRpcResult = typeof PrepareCardRpcResult.Type

export interface RpcClient {
  readonly prepareCoachInviteCard: (workspace: WorkspaceId, card: InviteCard) => Promise<unknown>
}

/**
 * Truthful fallback for runtimes that hold no Telegram credentials.
 *
 * The real implementation lives in the bot Worker (`apps/bot/src/bot-registry.ts`),
 * because sending through a workspace's own bot means decrypting its token,
 * classifying what Telegram answers, and repairing a refused credential — none
 * of which a package may do (ADR 0002: packages carry no app wiring). Anything
 * else that resolves this service gets a typed failure rather than the pretence
 * that a message was delivered.
 */
export const layer = Layer.sync(Service, () => {
  const send = Effect.fn("BotRegistry.send")(function* (
    workspace: WorkspaceId,
    _text: string,
    _options?: SendOptions,
  ) {
    return yield* Effect.fail(
      new SendFailed({ workspace, reason: "no coach-bot transport in this runtime" }),
    )
  })

  const prepareCard = Effect.fn("BotRegistry.prepareCard")(function* (
    workspace: WorkspaceId,
    _card: InviteCard,
  ) {
    return yield* Effect.fail(
      new PrepareFailed({ workspace, reason: "no coach-bot transport in this runtime" }),
    )
  })

  return Service.of({ send, prepareCard })
})

/**
 * The seam as the `web` Worker holds it: the coach's bot lives behind the
 * `MANAGER_BOT` service binding, so preparing a card is one RPC call.
 *
 * `send` stays a typed failure here rather than growing a second RPC method.
 * Nothing in the web Worker sends through a coach's bot — the coach-facing
 * pushes are the bot Worker's own (#55) — and an RPC surface nobody calls is a
 * second place for a refused credential to be handled differently, which is the
 * thing this ticket exists to avoid.
 */
export const rpcLayer = (client: RpcClient) =>
  Layer.succeed(
    Service,
    Service.of({
      send: Effect.fn("BotRegistry.Rpc.send")(function* (workspace: WorkspaceId) {
        return yield* Effect.fail(
          new SendFailed({ workspace, reason: "this runtime prepares cards only" }),
        )
      }),
      prepareCard: Effect.fn("BotRegistry.Rpc.prepareCard")(function* (
        workspace: WorkspaceId,
        card: InviteCard,
      ) {
        const result = yield* Effect.tryPromise({
          try: () => client.prepareCoachInviteCard(workspace, card),
          catch: () => new PrepareFailed({ workspace, reason: "bot worker unreachable" }),
        })
        const decoded = yield* Schema.decodeUnknownEffect(PrepareCardRpcResult)(result).pipe(
          Effect.mapError(() => new PrepareFailed({ workspace, reason: "bot worker unreachable" })),
        )
        if (PrepareCardRpcResult.guards.Failed(decoded)) {
          return yield* Effect.fail(
            new PrepareFailed({ workspace: decoded.workspace, reason: decoded.reason }),
          )
        }
        return {
          id: decoded.id,
          expiresAt: new Date(decoded.expiresAtMillis),
        } satisfies PreparedCard
      }),
    }),
  )

export interface SentMessage {
  readonly workspace: WorkspaceId
  readonly text: string
}

export interface PreparedCardRecord {
  readonly workspace: WorkspaceId
  readonly card: InviteCard
}

export interface TestInterface extends Interface {
  readonly sent: () => Effect.Effect<ReadonlyArray<SentMessage>>
  readonly prepared: () => Effect.Effect<ReadonlyArray<PreparedCardRecord>>
  readonly failNextPrepare: (failure: PrepareFailed) => Effect.Effect<void>
  /** How long the next minted card lives, so an expired id can be exercised. */
  readonly setCardLifetimeMillis: (millis: number) => Effect.Effect<void>
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@praximo/telegram/BotRegistry/Test",
) {}

/** What Telegram gives a prepared message; the stub mints the same window. */
export const PreparedCardLifetimeMillis = 30 * 60 * 1_000

export const testLayer = Layer.effectContext(
  Effect.gen(function* () {
    const messages = yield* Ref.make<ReadonlyArray<SentMessage>>([])
    const cards = yield* Ref.make<ReadonlyArray<PreparedCardRecord>>([])
    const nextPrepareFailure = yield* Ref.make<Option.Option<PrepareFailed>>(Option.none())
    const lifetime = yield* Ref.make(PreparedCardLifetimeMillis)

    const send = Effect.fn("BotRegistry.send")(function* (workspace: WorkspaceId, text: string) {
      yield* Ref.update(messages, (sent) => [...sent, { workspace, text }])
    })

    const prepareCard = Effect.fn("BotRegistry.Test.prepareCard")(function* (
      workspace: WorkspaceId,
      card: InviteCard,
    ) {
      const failure = yield* Ref.getAndSet(nextPrepareFailure, Option.none())
      if (Option.isSome(failure)) return yield* Effect.fail(failure.value)
      const previous = yield* Ref.getAndUpdate(cards, (minted) => [...minted, { workspace, card }])
      const now = yield* Clock.currentTimeMillis
      return {
        id: `prepared-card-${previous.length}`,
        expiresAt: new Date(now + (yield* Ref.get(lifetime))),
      } satisfies PreparedCard
    })

    const impl = TestService.of({
      send,
      sent: () => Ref.get(messages),
      prepareCard,
      prepared: () => Ref.get(cards),
      failNextPrepare: Effect.fn("BotRegistry.Test.failNextPrepare")((failure: PrepareFailed) =>
        Ref.set(nextPrepareFailure, Option.some(failure)),
      ),
      setCardLifetimeMillis: Effect.fn("BotRegistry.Test.setCardLifetimeMillis")((millis: number) =>
        Ref.set(lifetime, millis),
      ),
    })

    return Context.make(Service, impl).pipe(Context.add(TestService, impl))
  }),
)

export * as BotRegistry from "./bot-registry.ts"
