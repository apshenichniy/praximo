import { describe, expect, it } from "@effect/vitest"
import { WorkspaceId } from "@praximo/domain"
import { Effect } from "effect"
import { CoachBotBranding } from "./coach-bot-branding.ts"

const profile: CoachBotBranding.Profile = {
  workspaceId: WorkspaceId.make("ws_ada"),
  description: "Thoughtful coaching",
  avatar: CoachBotBranding.AvatarUpdate.cases.Apply.make({
    r2Key: "workspace-branding/ada/avatar.jpg",
  }),
}

describe("CoachBotBranding", () => {
  it.effect("gracefully skips while no connected-bot adapter exists", () =>
    Effect.gen(function* () {
      const branding = yield* CoachBotBranding.Service
      expect(yield* branding.apply(profile)).toBe("skipped")
    }).pipe(Effect.provide(CoachBotBranding.layer)),
  )

  it.effect("records the profile contract without any Telegram bot-name field", () =>
    Effect.gen(function* () {
      const branding = yield* CoachBotBranding.Service
      expect(yield* branding.apply(profile)).toBe("applied")
      const test = yield* CoachBotBranding.TestService
      expect(yield* test.applied()).toEqual([profile])
      expect(profile).not.toHaveProperty("name")
    }).pipe(Effect.provide(CoachBotBranding.testLayer)),
  )

  it.effect("surfaces a typed provider failure", () =>
    Effect.gen(function* () {
      const branding = yield* CoachBotBranding.Service
      const test = yield* CoachBotBranding.TestService
      yield* test.failNextApply()
      const error = yield* Effect.flip(branding.apply(profile))
      expect(error._tag).toBe("CoachBotBranding.ApplyFailed")
    }).pipe(Effect.provide(CoachBotBranding.testLayer)),
  )
})
