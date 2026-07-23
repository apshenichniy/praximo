import { WorkspaceId } from "@praximo/domain"
import { Context, Effect, Layer, Ref, Schema } from "effect"

export const Result = Schema.TaggedUnion({
  Released: {},
  NotConnected: {},
  AlreadyReleased: {},
  Failed: { retryable: Schema.Boolean },
})
export type Result = typeof Result.Type

export interface RpcClient {
  readonly releaseCoachBot: (workspaceId: WorkspaceId) => Promise<Result>
}

export interface Interface {
  readonly release: (workspaceId: WorkspaceId) => Effect.Effect<Result>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/telegram/CoachBotRelease",
) {}

/** Truthful fallback for runtimes without the managed-bot credential adapter. */
export const layer = Layer.succeed(
  Service,
  Service.of({
    release: Effect.fn("CoachBotRelease.release")(() =>
      Effect.succeed(Result.cases.NotConnected.make({})),
    ),
  }),
)

export const rpcLayer = (client: RpcClient) =>
  Layer.succeed(
    Service,
    Service.of({
      release: Effect.fn("CoachBotRelease.Rpc.release")(function* (workspaceId) {
        const result = yield* Effect.tryPromise({
          try: () => client.releaseCoachBot(workspaceId),
          catch: () => Result.cases.Failed.make({ retryable: true }),
        }).pipe(Effect.catch((failure) => Effect.succeed(failure)))
        return yield* Schema.decodeUnknownEffect(Result)(result).pipe(
          Effect.catch(() => Effect.succeed(Result.cases.Failed.make({ retryable: true }))),
        )
      }),
    }),
  )

export interface TestInterface extends Interface {
  readonly released: () => Effect.Effect<ReadonlyArray<WorkspaceId>>
  readonly setNextResult: (result: Result) => Effect.Effect<void>
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@praximo/telegram/CoachBotRelease/Test",
) {}

export const testLayer = Layer.effectContext(
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<WorkspaceId>>([])
    const next = yield* Ref.make<Result>(Result.cases.NotConnected.make({}))
    const release = Effect.fn("CoachBotRelease.Test.release")(function* (workspaceId) {
      yield* Ref.update(calls, (current) => [...current, workspaceId])
      return yield* Ref.get(next)
    })
    const impl = TestService.of({
      release,
      released: Effect.fn("CoachBotRelease.Test.released")(() => Ref.get(calls)),
      setNextResult: Effect.fn("CoachBotRelease.Test.setNextResult")((result) =>
        Ref.set(next, result),
      ),
    })
    return Context.make(Service, impl).pipe(Context.add(TestService, impl))
  }),
)

export * as CoachBotRelease from "./coach-bot-release.ts"
