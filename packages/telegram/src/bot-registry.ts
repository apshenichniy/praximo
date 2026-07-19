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
 * The live implementation is deliberately unwired: bot provisioning and the
 * shared grammY client arrive with their own tickets. It fails loudly rather
 * than pretending a message was delivered.
 */
export const layer = Layer.sync(Service, () => {
  const send = Effect.fn("BotRegistry.send")(function* (workspace: WorkspaceId, _text: string) {
    return yield* Effect.fail(
      new SendFailed({ workspace, reason: "telegram delivery is not wired yet" }),
    )
  })

  return Service.of({ send })
})

export interface TestInterface extends Interface {
  readonly sent: Effect.Effect<
    ReadonlyArray<{ readonly workspace: WorkspaceId; readonly text: string }>
  >
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@praximo/telegram/BotRegistry/Test",
) {}

export const testLayer = Layer.effectContext(
  Effect.gen(function* () {
    const messages = yield* Ref.make<
      ReadonlyArray<{ readonly workspace: WorkspaceId; readonly text: string }>
    >([])

    const send = Effect.fn("BotRegistry.send")(function* (workspace: WorkspaceId, text: string) {
      yield* Ref.update(messages, (sent) => [...sent, { workspace, text }])
    })

    const impl: TestInterface = { send, sent: Ref.get(messages) }

    return Context.make(Service, impl).pipe(Context.add(TestService, impl))
  }),
)

export * as BotRegistry from "./bot-registry.ts"
