import { describe, expect, it } from "@effect/vitest"
import { CoachOnboardingInviteId } from "@praximo/domain"
import { Effect } from "effect"
import { CoachOnboardingToken } from "./coach-onboarding-token.ts"

const inviteId = CoachOnboardingInviteId.make("01K11YJ6GJ2W7P8RN89M7B33AP")

describe("CoachOnboardingToken", () => {
  it.effect("mints a deterministic Telegram-safe deep link", () =>
    Effect.gen(function* () {
      const tokens = yield* CoachOnboardingToken.Service
      const first = yield* tokens.linkFor(inviteId)
      const second = yield* tokens.linkFor(inviteId)

      expect(first).toBe(second)
      expect(first).toMatch(
        /^https:\/\/t\.me\/PraximoMotherBot\?start=ws_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/,
      )
      expect(new URL(first).searchParams.get("start")?.length).toBeLessThanOrEqual(64)
    }).pipe(Effect.provide(CoachOnboardingToken.testLayer("secret-for-tests", "PraximoMotherBot"))),
  )

  it.effect("verifies the invite id and rejects tampering or malformed input", () =>
    Effect.gen(function* () {
      const tokens = yield* CoachOnboardingToken.Service
      const parameter = yield* tokens.parameterFor(inviteId)

      expect(yield* tokens.verify(parameter)).toBe(inviteId)
      yield* Effect.flip(tokens.verify(`${parameter.slice(0, -1)}x`))
      yield* Effect.flip(tokens.verify("invalid parameter"))
      yield* Effect.flip(tokens.verify("w".repeat(65)))
    }).pipe(Effect.provide(CoachOnboardingToken.testLayer("secret-for-tests", "PraximoMotherBot"))),
  )
})
