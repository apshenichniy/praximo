import { describe, expect, it } from "vitest"
import { canUseLocalProcessEnvironment } from "./runtime-environment.ts"

const completeEnvironment = {
  DATABASE_URL: "postgres://example",
  MANAGER_BOT_TOKEN: "token",
  MANAGER_BOT_USERNAME: "PraximoMotherBot",
  TELEGRAM_ENV: "production",
  CLIENT_APP_URL: "http://localhost:3001",
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
    // A binding added later is a binding this gate must also require: falling
    // through to the Worker branch is what `requireString` throws on locally.
    expect(
      canUseLocalProcessEnvironment(true, {
        ...completeEnvironment,
        TELEGRAM_ENV: undefined,
      }),
    ).toBe(false)
    // #191's binding, and the newest instance of that same rule.
    expect(
      canUseLocalProcessEnvironment(true, {
        ...completeEnvironment,
        CLIENT_APP_URL: undefined,
      }),
    ).toBe(false)
  })
})
