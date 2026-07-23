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

/**
 * Ticket #52 owns connected-bot credential acquisition and the real Telegram
 * adapter. Until that layer exists, profile persistence remains authoritative
 * and applying branding is a truthful successful no-op.
 */
export const layer = Layer.sync(Service, () =>
  Service.of({
    apply: Effect.fn("CoachBotBranding.apply")(() => Effect.succeed("skipped" as const)),
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
