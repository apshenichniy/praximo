import { describe, expect, it } from "vitest"
import { fillGaps, makeCatalogue, MissingTranslation } from "./gaps.ts"

interface Copy {
  readonly title: string
  readonly points: readonly [string, string]
  readonly nested: { readonly accept: string }
}

const en: Copy = {
  title: "Before you start",
  points: ["You decide.", "The AI is assistive."],
  nested: { accept: "I agree" },
}

const uk: Copy = {
  title: "Перш ніж почати",
  points: ["Ви вирішуєте.", "ШІ — допоміжний."],
  nested: { accept: "Погоджуюсь" },
}

const where = "the catalogue"

describe("fillGaps", () => {
  it("fails visibly in strict mode, naming the leaf to fix", () => {
    const blanked: Copy = { ...uk, nested: { accept: "  " } }

    expect(() => fillGaps(en, blanked, "uk", { strict: true, where })).toThrow(MissingTranslation)
    expect(() => fillGaps(en, blanked, "uk", { strict: true, where })).toThrow("nested.accept")
  })

  it("names an array index, so a blank list item is findable", () => {
    const blanked: Copy = { ...uk, points: [uk.points[0], ""] }

    expect(() => fillGaps(en, blanked, "uk", { strict: true, where })).toThrow("points.1")
  })

  it("falls back to the reference leaf otherwise, and only for the gap", () => {
    const blanked: Copy = { ...uk, nested: { accept: "" } }

    const filled = fillGaps(en, blanked, "uk", { strict: false, where })

    expect(filled.nested.accept).toBe(en.nested.accept)
    // Everything around the gap is still Ukrainian.
    expect(filled.title).toBe(uk.title)
    expect(filled.points).toEqual(uk.points)
  })

  /**
   * The bot catalogue interpolates a bot username through a function-valued
   * field. A function is present by definition, so the walk has to hand it back
   * rather than treat it as a blank leaf.
   */
  it("passes a function-valued leaf through untouched", () => {
    const reference = { greet: (name: string) => `Hi ${name}` }
    const translation = { greet: (name: string) => `Вітаю, ${name}` }

    const filled = fillGaps(reference, translation, "uk", { strict: true, where })

    expect(filled.greet("Ada")).toBe("Вітаю, Ada")
  })
})

describe("makeCatalogue", () => {
  const catalogue = makeCatalogue({
    reference: "en",
    byLocale: { en, uk, ru: uk },
    strict: true,
    where,
  })

  it("hands back the reference catalogue by identity", () => {
    expect(catalogue("en")).toBe(en)
  })

  it("resolves a locale once and reuses the answer", () => {
    expect(catalogue("uk")).toBe(catalogue("uk"))
    expect(catalogue("uk").title).toBe(uk.title)
  })
})
