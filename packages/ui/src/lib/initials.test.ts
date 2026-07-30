import { describe, expect, it } from "vitest"
import { initials } from "./initials.ts"

/**
 * The one implementation, and the edges the four it replaced disagreed about
 * (#231). Every case below is a name a real person could be filed under.
 */
describe("initials", () => {
  it("takes two letters from two words and one from one", () => {
    expect(initials("Ada Lovelace")).toBe("AL")
    expect(initials("Ada")).toBe("A")
  })

  it("stops at two, because a monogram is a shape rather than text", () => {
    expect(initials("Ada Byron King Lovelace")).toBe("AB")
  })

  it("reads a hyphen as a word break, so a double-barrelled name is a monogram", () => {
    // The edge three of the replaced copies got wrong: splitting on whitespace
    // alone left a hyphenated given name with one letter and a lonely disc.
    expect(initials("Jean-Luc")).toBe("JL")
    expect(initials("Anna-Maria")).toBe("AM")
    // Consequence worth stating rather than hiding: the first two *words* win, so a
    // hyphenated given name uses up both letters and the surname does not appear.
    expect(initials("Anna-Maria Koval")).toBe("AM")
  })

  it("works in all three alphabets the product speaks", () => {
    expect(initials("Марія Коваленко")).toBe("МК")
    expect(initials("Мария Иванова")).toBe("МИ")
    expect(initials("Ada Lovelace")).toBe("AL")
  })

  it("takes a whole character, never half a surrogate pair", () => {
    // Indexed by code unit this yields a lone surrogate, which renders as the
    // replacement glyph — a broken box where somebody's initial should be.
    const monogram = initials("𝐀da Lovelace")

    expect(Array.from(monogram)).toHaveLength(2)
    expect(monogram).not.toContain("�")
  })

  it("survives the shapes a name field actually receives", () => {
    expect(initials("  ada   lovelace  ")).toBe("AL")
    expect(initials("")).toBe("")
    expect(initials("   ")).toBe("")
    expect(initials("-")).toBe("")
  })
})
