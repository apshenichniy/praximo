import { describe, expect, it } from "vitest"
import {
  coachTermsFor,
  type LegalBlock,
  type LegalDocument,
  type LegalInline,
  legalPlaceholders,
  privacyPolicyFor,
} from "./content.ts"
import { LEGAL_EFFECTIVE_DATE, PRIVACY_VERSION, placeholdersIn, TERMS_VERSION } from "./versions.ts"

const documents: ReadonlyArray<readonly [string, LegalDocument]> = [
  ["coach terms", coachTermsFor("en")],
  ["privacy policy", privacyPolicyFor("en")],
]

const LOCALES = ["en", "uk", "ru"] as const

/** Every run of authored prose in a document — the words, and nothing else. */
const textIn = (document: LegalDocument): ReadonlyArray<string> => {
  const found: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      found.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value === "object" && value !== null) {
      for (const item of Object.values(value)) walk(item)
    }
  }
  walk(document.intro)
  walk(document.sections)
  return found
}

/** The clause numbers the terms' headings open with. */
const numbers = (document: LegalDocument) =>
  document.sections.map((section) => section.heading.split(".")[0])

/** What a block is, minus every word of it. */
const blockShape = (block: LegalBlock): unknown => {
  if (block.kind === "paragraph")
    return { kind: block.kind, content: block.content.map(inlineShape) }
  if (block.kind === "list") {
    return { kind: block.kind, items: block.items.map((item) => item.map(inlineShape)) }
  }
  return {
    kind: block.kind,
    columns: block.head.length,
    rows: block.rows.map((row) => row.map(inlineShape)),
  }
}

const inlineShape = (inline: LegalInline): unknown => {
  if (typeof inline === "string") return "text"
  if ("emphasis" in inline) return "emphasis"
  // A link's destination and a placeholder's marker are not prose: they must be
  // identical across languages or the translation points somewhere else.
  if ("link" in inline) return { link: inline.to }
  return { placeholder: inline.placeholder }
}

describe("legal versions", () => {
  it("derives a dated version from the text itself", () => {
    for (const version of [TERMS_VERSION, PRIVACY_VERSION]) {
      expect(version).toMatch(/^\d{4}-\d{2}-\d{2}\+[0-9a-f]{7}$/)
      expect(version.startsWith(LEGAL_EFFECTIVE_DATE)).toBe(true)
    }
    // Two different documents must not share a version, or the record of which
    // one a coach accepted says nothing.
    expect(TERMS_VERSION).not.toBe(PRIVACY_VERSION)
  })

  /**
   * The literal values, pinned.
   *
   * `member.terms_version` records one of these against a coach who read the
   * text, so the version is a fact about the past, not a derived convenience: a
   * refactor that moves the digest — #167 lifted it into `@praximo/i18n` — must
   * produce the same string, or every recorded acceptance starts pointing at a
   * document nobody can identify. Editing a legal text is what may change these;
   * touching the machinery is not.
   */
  it("has not changed value", () => {
    expect(TERMS_VERSION).toBe("2026-08-01+72f5ad2")
    expect(PRIVACY_VERSION).toBe("2026-08-01+acb0203")
  })

  it("keeps the placeholder registry and the texts in step", () => {
    const registered = new Set(Object.keys(legalPlaceholders))
    const used = new Set(documents.flatMap(([, document]) => [...placeholdersIn(document)]))

    // A marker in the text that nobody registered would ship as a launch blocker
    // nobody knew about; a registered one nothing uses is a stale checklist item.
    expect(used).toEqual(registered)
  })

  /**
   * One version identifies a document a coach may read in any of three
   * languages, so the three have to *be* the same document. This compares their
   * skeletons — block kinds, list and table shapes, placeholders, link targets —
   * and ignores the prose, which is the only part that may differ.
   *
   * Without it, "the version recorded on acceptance is the version of the text
   * the coach actually saw" would be a hope rather than a property: a translator
   * dropping a subprocessor row or a DPA clause would silently ship a shorter
   * contract under a version that claims to be the longer one.
   */
  it("keeps the three languages structurally identical", () => {
    const shape = (document: LegalDocument): unknown => ({
      intro: document.intro.map(blockShape),
      sections: document.sections.map((section) => section.blocks.map(blockShape)),
    })

    for (const locale of ["uk", "ru"] as const) {
      expect(shape(coachTermsFor(locale)), `${locale} terms`).toEqual(shape(coachTermsFor("en")))
      expect(shape(privacyPolicyFor(locale)), `${locale} privacy`).toEqual(
        shape(privacyPolicyFor("en")),
      )
      expect(placeholdersIn(coachTermsFor(locale))).toEqual(placeholdersIn(coachTermsFor("en")))
      expect(placeholdersIn(privacyPolicyFor(locale))).toEqual(
        placeholdersIn(privacyPolicyFor("en")),
      )
    }
  })

  it("translates the prose rather than shipping English under a heading", () => {
    for (const locale of ["uk", "ru"] as const) {
      expect(coachTermsFor(locale).title).not.toBe(coachTermsFor("en").title)
      expect(privacyPolicyFor(locale).title).not.toBe(privacyPolicyFor("en").title)
      for (const [index, section] of coachTermsFor(locale).sections.entries()) {
        expect(section.heading).not.toBe(coachTermsFor("en").sections[index]?.heading)
      }
      for (const [index, section] of privacyPolicyFor(locale).sections.entries()) {
        expect(section.heading).not.toBe(privacyPolicyFor("en").sections[index]?.heading)
      }
    }
  })

  /**
   * The numbered headings of the terms are structure, not prose: a coach quoting
   * "section 6" to us, or us to them, has to land on the same clause in every
   * language.
   */
  it("numbers the terms' sections identically in every language", () => {
    for (const locale of ["uk", "ru"] as const) {
      expect(numbers(coachTermsFor(locale))).toEqual(numbers(coachTermsFor("en")))
    }
  })

  /**
   * The structural check above compares shapes, and an empty string still has
   * the shape of a string — so a translator's blank would pass it, ship, and
   * render as a hole in a contract. The copy catalogue has a runtime fallback
   * for this (`fillGaps`); a legal text has no honest fallback, because half an
   * English clause inside a Ukrainian contract is not a smaller failure than a
   * gap. So it is caught here instead, before it can be committed.
   */
  it("has no blank prose in any language", () => {
    for (const locale of LOCALES) {
      for (const document of [coachTermsFor(locale), privacyPolicyFor(locale)]) {
        expect(document.title.trim().length, `${locale} title`).toBeGreaterThan(0)
        for (const section of document.sections) {
          expect(section.heading.trim().length, `${locale} heading`).toBeGreaterThan(0)
        }
        for (const text of textIn(document)) {
          expect(text.trim().length, `${locale}: "${text}"`).toBeGreaterThan(0)
        }
      }
    }
  })

  /**
   * The same rule the copy catalogue is held to (#130), over the far larger
   * body of coach-addressed prose: no verb form in UK or RU may agree with a
   * gender the product has never been told. Past-tense singulars are where that
   * happens, and a translator writes one without noticing.
   */
  it("uses no gender-agreeing verb forms in the uk or ru texts", () => {
    const gendered = /\b(ви|вы|я)\s+\p{L}+(?:ли|ла|в|л)\b/giu

    for (const locale of ["uk", "ru"] as const) {
      for (const document of [coachTermsFor(locale), privacyPolicyFor(locale)]) {
        for (const text of [document.title, ...textIn(document)]) {
          expect(text, `${locale}: "${text}"`).not.toMatch(gendered)
        }
      }
    }
  })

  it("says who is the controller and what the AI output is worth", () => {
    // The ToS summary the coach agrees to promises these; the full text has to
    // actually contain them.
    const terms = JSON.stringify(coachTermsFor("en"))
    expect(terms).toContain("You are the controller, we are the processor.")
    expect(terms).toContain("assistive, not authoritative")
    expect(terms).toContain("not affiliated with, endorsed by, or certified by any coaching")
    expect(terms).toContain("early-access software")
  })
})
