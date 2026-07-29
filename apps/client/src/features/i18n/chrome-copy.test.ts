import { CoachLanguages } from "@praximo/domain"
import { describe, expect, it } from "vitest"

import { chromeCopy } from "@/features/i18n/chrome-copy.ts"

/**
 * The catalogue is resolved **not strict** — a reader who came to read a
 * contract must never meet a thrown `MissingTranslation` because a footer label
 * was missed. That decision only holds if something else keeps the three level,
 * and this is that something: without it, a gap falls back to English silently
 * and nobody finds out.
 */
describe("chrome copy", () => {
  it("says every word in all three languages", () => {
    for (const locale of CoachLanguages) {
      const copy = chromeCopy(locale)
      for (const [key, value] of Object.entries(copy.theme)) {
        expect(typeof value, `${locale} theme.${key}`).toBe("string")
        expect(value.trim().length, `${locale} theme.${key}`).toBeGreaterThan(0)
      }
    }
  })

  /**
   * The failure the fallback is designed to hide: a locale that was never
   * translated resolves to English and looks fine. Comparing against the
   * reference is what makes it visible.
   */
  it("translates them rather than falling back to English", () => {
    const reference = chromeCopy("en").theme

    for (const locale of CoachLanguages.filter((one) => one !== "en")) {
      const copy = chromeCopy(locale).theme
      for (const key of Object.keys(reference) as ReadonlyArray<keyof typeof reference>) {
        expect(copy[key], `${locale} theme.${key}`).not.toBe(reference[key])
      }
    }
  })

  /**
   * The three options are the switch's whole vocabulary, and `AppearanceMenu` reads
   * them by the same keys the preference is stored under. A rename on either
   * side would otherwise render an empty chip.
   */
  it("names each of the three appearance options", () => {
    for (const option of ["system", "light", "dark"] as const) {
      expect(chromeCopy("en").theme[option]).toBeTruthy()
    }
  })
})
