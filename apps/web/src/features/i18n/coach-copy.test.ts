import { describe, expect, it, vi } from "vitest"
import {
  coachCatalog,
  coachCopy,
  fillGaps,
  languageNames,
  MissingTranslation,
} from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"

const locales = ["en", "uk", "ru"] as const

/** Every leaf of a catalogue, as `path` → value. */
const leaves = (value: unknown, path = ""): ReadonlyArray<readonly [string, unknown]> => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leaves(item, `${path}.${index}`))
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, entry]) =>
      leaves(entry, path === "" ? key : `${path}.${key}`),
    )
  }
  return [[path, value]]
}

describe("coach copy", () => {
  it("says the same things in all three languages", () => {
    const reference = leaves(coachCatalog.en).map(([path]) => path)

    for (const locale of locales) {
      expect(leaves(coachCatalog[locale]).map(([path]) => path)).toEqual(reference)
    }
  })

  it("carries no empty strings — the trilingual bot catalogue shipped unread once already", () => {
    for (const locale of locales) {
      for (const [path, value] of leaves(coachCatalog[locale])) {
        expect(typeof value === "string" && value.trim().length > 0, `${locale}.${path}`).toBe(true)
      }
    }
  })

  it("is actually translated: no locale reuses the English sentence", () => {
    // Word-for-word matches are legitimate for a brand name or a Telegram
    // button label, so this checks the sentences that carry meaning.
    for (const locale of ["uk", "ru"] as const) {
      expect(coachCatalog[locale].terms.title).not.toBe(coachCatalog.en.terms.title)
      expect(coachCatalog[locale].language.greeting).not.toBe(coachCatalog.en.language.greeting)
      expect(coachCatalog[locale].home.relinkTitle).not.toBe(coachCatalog.en.home.relinkTitle)
      expect(coachCatalog[locale].clients.listTitle).not.toBe(coachCatalog.en.clients.listTitle)
      expect(coachCatalog[locale].clients.deleteBody).not.toBe(coachCatalog.en.clients.deleteBody)
      for (const [index, point] of coachCatalog[locale].terms.points.entries()) {
        expect(point).not.toBe(coachCatalog.en.terms.points[index])
      }
    }
  })

  it("names each language in its own tongue", () => {
    expect(languageNames).toEqual({ en: "English", uk: "Українська", ru: "Русский" })
  })

  /**
   * The gender rule (#130): no string addressed at or about the coach may use a
   * verb form that has to agree with a gender the product was never told. In
   * Ukrainian and Russian that is the past-tense singular — the `-в`/`-ла`,
   * `-л`/`-ла` endings — and it is the one mistake a translator makes without
   * noticing.
   */
  it("uses no gender-agreeing verb forms in uk or ru", () => {
    const gendered = /\b(ви|вы|я)\s+\p{L}+(?:ли|ла|в|л)\b/giu

    for (const locale of ["uk", "ru"] as const) {
      for (const [path, value] of leaves(coachCatalog[locale])) {
        expect(String(value), `${locale}.${path}`).not.toMatch(gendered)
      }
    }
  })
})

describe("coachCopy", () => {
  it("hands back the catalogue for the locale asked for", () => {
    expect(coachCopy("uk").language.greeting).toBe(coachCatalog.uk.language.greeting)
    expect(coachCopy("ru").terms.accept).toBe(coachCatalog.ru.terms.accept)
    expect(coachCopy("en")).toBe(coachCatalog.en)
  })

  /**
   * The two halves of the ticket's fallback rule. `fillGaps` is what
   * `coachCopy` runs for a non-English locale; it is called directly here
   * because the behaviour is conditional on the build and a cached resolution
   * would only answer once.
   */
  it("fails visibly in development when a translation is blank", () => {
    const blanked = { ...coachCatalog.uk, terms: { ...coachCatalog.uk.terms, accept: "  " } }

    expect(() => fillGaps(coachCatalog.en, blanked, "uk")).toThrow(MissingTranslation)
    expect(() => fillGaps(coachCatalog.en, blanked, "uk")).toThrow("terms.accept")
  })

  it("falls back to English in production rather than rendering a key", () => {
    vi.stubEnv("DEV", false)
    const blanked = { ...coachCatalog.uk, terms: { ...coachCatalog.uk.terms, accept: "" } }

    const filled = fillGaps(coachCatalog.en, blanked, "uk")

    expect(filled.terms.accept).toBe(coachCatalog.en.terms.accept)
    // Only the gap falls back. Everything around it is still Ukrainian.
    expect(filled.terms.title).toBe(coachCatalog.uk.terms.title)
    vi.unstubAllEnvs()
  })
})

describe("launchLocale", () => {
  it("reads the language a launch claims, and never fails on junk", () => {
    const initData = new URLSearchParams({
      user: JSON.stringify({ id: 42, first_name: "Ada", language_code: "uk" }),
      auth_date: "1780000000",
    }).toString()

    expect(launchLocale(initData)).toBe("uk")
    expect(launchLocale("user=not-json&auth_date=1")).toBe("en")
    expect(launchLocale("")).toBe("en")
  })
})
