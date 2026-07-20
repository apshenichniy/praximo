import { describe, expect, it } from "@effect/vitest"
import { assertNotProd, resolveStage } from "./reset.ts"

// The safety-critical half of db:reset, tested with no database and no network —
// this suite runs everywhere, including CI without secrets.

describe("assertNotProd", () => {
  it("refuses the prod stage", () => {
    expect(() => assertNotProd("prod")).toThrow(/refuses to run against prod/)
  })

  it("allows a personal dev stage", () => {
    expect(() => assertNotProd("dev_alexander")).not.toThrow()
  })

  it("allows an ad-hoc named stage", () => {
    expect(() => assertNotProd("exp-foo")).not.toThrow()
  })
})

describe("resolveStage", () => {
  it("prefers APP_STAGE when set", () => {
    expect(resolveStage({ APP_STAGE: "dev_ci", USER: "alexander" })).toBe("dev_ci")
  })

  it("falls back to the dev_<user> default", () => {
    expect(resolveStage({ USER: "alexander" })).toBe("dev_alexander")
  })

  it("throws when neither APP_STAGE nor USER is set", () => {
    expect(() => resolveStage({})).toThrow(/cannot resolve stage/)
  })
})
