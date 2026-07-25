import { describe, expect, it } from "vitest"
import {
  coachTermsFor,
  type LegalDocument,
  legalPlaceholders,
  privacyPolicyFor,
} from "@/features/legal/content.ts"
import {
  LEGAL_EFFECTIVE_DATE,
  PRIVACY_VERSION,
  placeholdersIn,
  TERMS_VERSION,
} from "@/features/legal/versions.ts"

const documents: ReadonlyArray<readonly [string, LegalDocument]> = [
  ["coach terms", coachTermsFor("en")],
  ["privacy policy", privacyPolicyFor("en")],
]

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

  it("keeps the placeholder registry and the texts in step", () => {
    const registered = new Set(Object.keys(legalPlaceholders))
    const used = new Set(documents.flatMap(([, document]) => [...placeholdersIn(document)]))

    // A marker in the text that nobody registered would ship as a launch blocker
    // nobody knew about; a registered one nothing uses is a stale checklist item.
    expect([...used].sort()).toEqual([...registered].sort())
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
