import { describe, expect, it } from "vitest"
import { plural, type PluralForms } from "./plural.ts"

/** «session» in each language, in every form its language distinguishes. */
const sessions: Record<"en" | "uk" | "ru", PluralForms> = {
  en: { one: "{count} session", other: "{count} sessions" },
  uk: { one: "{count} сесія", few: "{count} сесії", many: "{count} сесій", other: "{count} сесії" },
  ru: {
    one: "{count} сессия",
    few: "{count} сессии",
    many: "{count} сессий",
    other: "{count} сессии",
  },
}

describe("plural", () => {
  /**
   * 21 is the case hand-written pluralisation always gets wrong: it returns to
   * the singular form in both Slavic languages, and a `count === 1` check misses
   * it. 1 / 2 / 5 / 21 pins one member of each category.
   */
  it("picks the right form for 1 / 2 / 5 / 21 in every language", () => {
    expect([1, 2, 5, 21].map((count) => plural("en", count, sessions.en))).toEqual([
      "1 session",
      "2 sessions",
      "5 sessions",
      "21 sessions",
    ])
    expect([1, 2, 5, 21].map((count) => plural("uk", count, sessions.uk))).toEqual([
      "1 сесія",
      "2 сесії",
      "5 сесій",
      "21 сесія",
    ])
    expect([1, 2, 5, 21].map((count) => plural("ru", count, sessions.ru))).toEqual([
      "1 сессия",
      "2 сессии",
      "5 сессий",
      "21 сессия",
    ])
  })

  it("falls back to `other` for a category the field does not list", () => {
    // English has no `few`; Ukrainian 3 selects it, so a field written with only
    // `one` and `other` still renders a sentence rather than nothing.
    expect(plural("uk", 3, { one: "{count} день", other: "{count} дня" })).toBe("3 дня")
  })

  it("interpolates every occurrence of the count", () => {
    expect(plural("en", 2, { one: "{count} of {count}", other: "{count} of {count}" })).toBe(
      "2 of 2",
    )
  })
})
