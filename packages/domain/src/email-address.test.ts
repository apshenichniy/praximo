import { describe, expect, it } from "@effect/vitest"

import { EmailAddressMaxLength, readEmailAddress } from "./email-address.ts"

describe("readEmailAddress", () => {
  it("accepts an ordinary address and trims it", () => {
    expect(readEmailAddress("anna@example.com")).toBe("anna@example.com")
    expect(readEmailAddress("  anna@example.com  ")).toBe("anna@example.com")
  })

  // The shape both call sites already enforced, kept verbatim: there is
  // something either side of an @, with a dot after it. Anything stricter
  // eventually rejects somebody's real address.
  it("accepts the addresses a stricter regex would turn away", () => {
    expect(readEmailAddress("anna+coach@example.co.uk")).toBe("anna+coach@example.co.uk")
    expect(readEmailAddress("a.b_c-d@sub.example.museum")).toBe("a.b_c-d@sub.example.museum")
    expect(readEmailAddress("анна@пример.рф")).toBe("анна@пример.рф")
  })

  it("refuses what is obviously not an address", () => {
    expect(readEmailAddress("")).toBeUndefined()
    expect(readEmailAddress("   ")).toBeUndefined()
    expect(readEmailAddress("anna")).toBeUndefined()
    expect(readEmailAddress("anna@example")).toBeUndefined()
    expect(readEmailAddress("@example.com")).toBeUndefined()
    expect(readEmailAddress("anna@@example.com")).toBeUndefined()
    expect(readEmailAddress("anna example@test.com")).toBeUndefined()
  })

  // RFC 5321's ceiling for the whole address. The cap is a stop, not a budget:
  // nothing counts down to it on any screen.
  it("refuses an address past the RFC 5321 ceiling", () => {
    const local = "a".repeat(EmailAddressMaxLength - "@example.com".length)
    expect(readEmailAddress(`${local}@example.com`)).toBe(`${local}@example.com`)
    expect(readEmailAddress(`${local}a@example.com`)).toBeUndefined()
  })

  // Length is measured after trimming, so surrounding whitespace cannot push an
  // otherwise fine address over the edge.
  it("measures length after trimming", () => {
    const local = "a".repeat(EmailAddressMaxLength - "@example.com".length)
    expect(readEmailAddress(`  ${local}@example.com  `)).toBe(`${local}@example.com`)
  })
})
