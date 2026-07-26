import { describe, expect, it } from "vitest"
import { contentDigest } from "./digest.ts"

describe("contentDigest", () => {
  it("is seven lowercase hex characters", () => {
    expect(contentDigest("Praximo")).toMatch(/^[0-9a-f]{7}$/)
    expect(contentDigest("")).toMatch(/^[0-9a-f]{7}$/)
  })

  /**
   * The pinned value is the contract, not an implementation detail: a coach's
   * recorded `terms_version` is derived from it, so changing the hash silently
   * re-versions a document somebody already accepted.
   */
  it("is stable for a given text", () => {
    expect(contentDigest("Praximo")).toBe(contentDigest("Praximo"))
    expect(contentDigest("terms of service")).toBe("101dd52")
  })

  it("separates two texts that differ by one character", () => {
    expect(contentDigest("liability cap: 100")).not.toBe(contentDigest("liability cap: 200"))
  })
})
