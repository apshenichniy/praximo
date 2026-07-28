import { describe, expect, it } from "@effect/vitest"
import { CoachOnboardingInviteCode } from "@praximo/domain"
import { Effect } from "effect"
import { CoachOnboardingToken } from "./coach-onboarding-token.ts"

const code = CoachOnboardingInviteCode.make("ABCD2345")

describe("CoachOnboardingToken", () => {
  it.effect("mints a short Telegram-safe deep link from the invite code", () =>
    Effect.gen(function* () {
      const tokens = yield* CoachOnboardingToken.Service
      const link = yield* tokens.linkFor(code)

      expect(link).toBe("https://t.me/PraximoBot?start=ws_ABCD2345")
      expect(new URL(link).searchParams.get("start")?.length).toBeLessThanOrEqual(64)
    }).pipe(Effect.provide(CoachOnboardingToken.testLayer("PraximoBot"))),
  )

  it.effect("reads a well-formed code back and rejects malformed or legacy links", () =>
    Effect.gen(function* () {
      const tokens = yield* CoachOnboardingToken.Service

      expect(yield* tokens.verify("ws_ABCD2345")).toBe(code)
      // Legacy `ws_{inviteId}_{sig}` links no longer resolve.
      yield* Effect.flip(tokens.verify("ws_01K11YJ6GJ2W7P8RN89M7B33AP_abcdef0123456789abcdef"))
      // Ambiguous glyphs (0 O 1 I) are outside the alphabet.
      yield* Effect.flip(tokens.verify("ws_ABCD0I1O"))
      yield* Effect.flip(tokens.verify("ws_abcd2345"))
      yield* Effect.flip(tokens.verify("ws_ABCD234"))
      yield* Effect.flip(tokens.verify("invalid parameter"))
      yield* Effect.flip(tokens.verify("w".repeat(65)))
    }).pipe(Effect.provide(CoachOnboardingToken.testLayer("PraximoBot"))),
  )
})
