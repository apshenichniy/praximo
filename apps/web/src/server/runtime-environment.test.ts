import { describe, expect, it } from "vitest"
import { canUseLocalProcessEnvironment } from "./runtime-environment.ts"

const completeEnvironment = {
  DATABASE_URL: "postgres://example",
  MANAGER_BOT_TOKEN: "token",
  MANAGER_BOT_USERNAME: "PraximoMotherBot",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: "branding/default.jpg",
}

describe("runtime environment selection", () => {
  it("uses process env only in local Vite development", () => {
    expect(canUseLocalProcessEnvironment(true, completeEnvironment)).toBe(true)
    expect(canUseLocalProcessEnvironment(false, completeEnvironment)).toBe(false)
  })

  it("does not select a partial local environment", () => {
    expect(
      canUseLocalProcessEnvironment(true, {
        ...completeEnvironment,
        DATABASE_URL: undefined,
      }),
    ).toBe(false)
  })
})
