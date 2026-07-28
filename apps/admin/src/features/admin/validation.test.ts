import { describe, expect, it } from "vitest"
import { inviteEmail } from "./validation.ts"

describe("inviteEmail", () => {
  it("accepts ordinary addresses, ignoring surrounding whitespace", () => {
    expect(inviteEmail("ada@lovelace.coach")).toBeUndefined()
    expect(inviteEmail("  ada.lovelace+coaching@sub.example.co.uk  ")).toBeUndefined()
  })

  it("asks for an address before it complains about its shape", () => {
    expect(inviteEmail("")).toBe("Email is required")
    expect(inviteEmail("   ")).toBe("Email is required")
  })

  it("rejects what no mail server would accept", () => {
    const malformed = [
      "ada",
      "ada@",
      "@lovelace.coach",
      "ada@lovelace",
      "ada@lovelace.",
      "ada lovelace@example.com",
      "ada@@example.com",
      "ada@example .com",
    ]
    for (const value of malformed) {
      expect(inviteEmail(value), value).toBe("Enter a valid email address")
    }
  })
})
