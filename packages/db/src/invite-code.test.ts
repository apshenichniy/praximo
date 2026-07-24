import { describe, expect, it } from "vitest"
import {
  CoachOnboardingInviteCodeAlphabet,
  CoachOnboardingInviteCodeLength,
  CoachOnboardingInviteCodePattern,
} from "@praximo/domain"
import { generateInviteCode } from "./coach-onboarding-repo.ts"

describe("generateInviteCode", () => {
  it("draws codes from the ambiguity-free alphabet", () => {
    expect(CoachOnboardingInviteCodeAlphabet).not.toMatch(/[0O1I]/)
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode()
      expect(code).toHaveLength(CoachOnboardingInviteCodeLength)
      expect(code).toMatch(CoachOnboardingInviteCodePattern)
    }
  })

  it("does not repeat within a small sample", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) seen.add(generateInviteCode())
    expect(seen.size).toBe(500)
  })

  it("exercises every symbol across enough draws", () => {
    const used = new Set<string>()
    for (let i = 0; i < 5_000; i++) {
      for (const char of generateInviteCode()) used.add(char)
    }
    expect(used.size).toBe(CoachOnboardingInviteCodeAlphabet.length)
  })
})
