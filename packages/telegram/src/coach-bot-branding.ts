import { WorkspaceId } from "@praximo/domain"
import { Context, Effect, Layer, Ref, Schema } from "effect"

export const AvatarUpdate = Schema.TaggedUnion({
  Keep: {},
  Apply: { r2Key: Schema.NonEmptyString },
})
export type AvatarUpdate = typeof AvatarUpdate.Type

export const Profile = Schema.Struct({
  workspaceId: WorkspaceId,
  description: Schema.optionalKey(Schema.String),
  shortDescription: Schema.optionalKey(Schema.String),
  avatar: AvatarUpdate,
})
export interface Profile extends Schema.Schema.Type<typeof Profile> {}

export const ApplyOutcome = Schema.Literals(["applied", "skipped"])
export type ApplyOutcome = typeof ApplyOutcome.Type

export interface Interface {
  readonly apply: (profile: Profile) => Effect.Effect<ApplyOutcome, ApplyFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/telegram/CoachBotBranding",
) {}

export class ApplyFailed extends Schema.TaggedErrorClass<ApplyFailed>()(
  "CoachBotBranding.ApplyFailed",
  {
    workspaceId: WorkspaceId,
  },
) {}

export const RpcResult = Schema.TaggedUnion({
  Applied: {},
  Failed: {},
})
export type RpcResult = typeof RpcResult.Type

export interface RpcClient {
  readonly applyCoachBotBranding: (profile: Profile) => Promise<unknown>
}

/** Local use has no credential boundary; production uses the bot Worker RPC. */
export const layer = Layer.sync(Service, () =>
  Service.of({
    apply: Effect.fn("CoachBotBranding.apply")((profile) =>
      Effect.fail(new ApplyFailed({ workspaceId: profile.workspaceId })),
    ),
  }),
)

export const rpcLayer = (client: RpcClient) =>
  Layer.succeed(
    Service,
    Service.of({
      apply: Effect.fn("CoachBotBranding.Rpc.apply")(function* (profile: Profile) {
        const result = yield* Effect.tryPromise({
          try: () => client.applyCoachBotBranding(profile),
          catch: () => new ApplyFailed({ workspaceId: profile.workspaceId }),
        })
        const decoded = yield* Schema.decodeUnknownEffect(RpcResult)(result).pipe(
          Effect.mapError(() => new ApplyFailed({ workspaceId: profile.workspaceId })),
        )
        if (RpcResult.guards.Failed(decoded)) {
          return yield* new ApplyFailed({ workspaceId: profile.workspaceId })
        }
        return "applied" as const
      }),
    }),
  )

export interface TestInterface extends Interface {
  readonly applied: () => Effect.Effect<ReadonlyArray<Profile>>
  readonly failNextApply: () => Effect.Effect<void>
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@praximo/telegram/CoachBotBranding/Test",
) {}

export const testLayer = Layer.effectContext(
  Effect.gen(function* () {
    const profiles = yield* Ref.make<ReadonlyArray<Profile>>([])
    const nextFailure = yield* Ref.make(false)

    const apply = Effect.fn("CoachBotBranding.Test.apply")(function* (profile: Profile) {
      if (yield* Ref.getAndSet(nextFailure, false)) {
        return yield* new ApplyFailed({ workspaceId: profile.workspaceId })
      }
      yield* Ref.update(profiles, (applied) => [...applied, profile])
      return "applied" as const
    })
    const applied = Effect.fn("CoachBotBranding.Test.applied")(() => Ref.get(profiles))
    const failNextApply = Effect.fn("CoachBotBranding.Test.failNextApply")(() =>
      Ref.set(nextFailure, true),
    )
    const impl = TestService.of({ apply, applied, failNextApply })
    return Context.make(Service, impl).pipe(Context.add(TestService, impl))
  }),
)

export * as CoachBotBranding from "./coach-bot-branding.ts"
