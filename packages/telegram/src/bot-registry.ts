import { WorkspaceId } from "@praximo/domain"
import { Context, Effect, Layer, Ref, Schema } from "effect"

/**
 * Resolves a workspace's dedicated bot and sends messages through it.
 *
 * This is the reference implementation of the project's Effect module style
 * (ADR 0002): file-local `Interface` / `Service` / `layer` roles, errors next to
 * the owning service, operations wrapped in `Effect.fn`, and a canonical module
 * namespace self-exported at the bottom of the file.
 */
export interface Interface {
  readonly send: (workspace: WorkspaceId, text: string) => Effect.Effect<void, SendFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/telegram/BotRegistry",
) {}

export class SendFailed extends Schema.TaggedErrorClass<SendFailed>()("BotRegistry.SendFailed", {
  workspace: WorkspaceId,
  reason: Schema.String,
}) {}

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
  const send = Effect.fn("BotRegistry.send")(function* (workspace: WorkspaceId, _text: string) {
    return yield* Effect.fail(
      new SendFailed({ workspace, reason: "no coach-bot transport in this runtime" }),
    )
  })

  return Service.of({ send })
})

export interface SentMessage {
  readonly workspace: WorkspaceId
  readonly text: string
}

export interface TestInterface extends Interface {
  readonly sent: () => Effect.Effect<ReadonlyArray<SentMessage>>
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@praximo/telegram/BotRegistry/Test",
) {}

export const testLayer = Layer.effectContext(
  Effect.gen(function* () {
    const messages = yield* Ref.make<ReadonlyArray<SentMessage>>([])

    const send = Effect.fn("BotRegistry.send")(function* (workspace: WorkspaceId, text: string) {
      yield* Ref.update(messages, (sent) => [...sent, { workspace, text }])
    })

    const impl = TestService.of({ send, sent: () => Ref.get(messages) })

    return Context.make(Service, impl).pipe(Context.add(TestService, impl))
  }),
)

export * as BotRegistry from "./bot-registry.ts"
