import { afterEach, describe, expect, it } from "@effect/vitest"
import { requireEnv } from "./env.ts"

// The one thing every script runner does before it can do anything else. The
// message is the whole point of the helper: an operator who hits it must be told
// where to set the value, not merely that it is absent.

const VARIABLE = "PRAXIMO_ENV_TEST_VARIABLE"

afterEach(() => {
  delete process.env[VARIABLE]
})

describe("requireEnv", () => {
  it("returns the value when the variable is set", () => {
    process.env[VARIABLE] = "present"
    expect(requireEnv(VARIABLE)).toBe("present")
  })

  it("points at the root .env by default", () => {
    expect(() => requireEnv(VARIABLE)).toThrow(
      `missing ${VARIABLE} — set it in the root .env (see .env.example)`,
    )
  })

  it("carries a caller's own hint instead, for a variable .env never holds", () => {
    // `ci-neon-branch.ts` reads GitHub Actions secrets: pointing its operator at
    // a local file would send them to the wrong place entirely.
    expect(() => requireEnv(VARIABLE, "set the repository secret")).toThrow(
      `missing ${VARIABLE} — set the repository secret`,
    )
  })

  it("treats an empty value as missing, not as a value", () => {
    process.env[VARIABLE] = ""
    expect(() => requireEnv(VARIABLE)).toThrow(/^missing /)
  })
})
