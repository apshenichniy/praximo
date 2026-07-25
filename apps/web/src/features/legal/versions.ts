import {
  coachTermsFor,
  type LegalDocument,
  type LegalPlaceholder,
  legalPlaceholders,
  privacyPolicyFor,
} from "@/features/legal/content.ts"

/**
 * The day these texts take effect. It leads the version so a human reading a
 * `member.terms_version` can date it without a lookup.
 */
export const LEGAL_EFFECTIVE_DATE = "2026-08-01"

/**
 * FNV-1a over the document's own content. Not a security primitive — its whole
 * job is that two different texts cannot share a version.
 */
const digest = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0").slice(1)
}

/**
 * A version derived from the text it names, rendered `2026-08-01+a1b2c3d`.
 *
 * Derived rather than hand-maintained because the texts still carry
 * placeholders: filling in the operator's legal name or the liability cap
 * produces a materially different document, and a hand-written "1.0" would let
 * that ship as the same version a coach had already accepted.
 *
 * Computed from the English text only. That is the text a coach accepts in this
 * slice, so it is the one the record has to identify; the i18n ticket decides
 * whether a translation gets its own version or inherits this one.
 */
const versionOf = (document: LegalDocument): string =>
  `${LEGAL_EFFECTIVE_DATE}+${digest(JSON.stringify(document))}`

export const TERMS_VERSION = versionOf(coachTermsFor("en"))

/**
 * Exists so the privacy page can display a version and so the column that
 * records one later has a source. Nothing persists it in MVP: a privacy
 * revision is deliberately unrecorded, and `member.terms_version` covers the
 * terms alone (ADR 0006).
 */
export const PRIVACY_VERSION = versionOf(privacyPolicyFor("en"))

/** Every placeholder marker either document actually contains. */
export const placeholdersIn = (document: LegalDocument): ReadonlySet<LegalPlaceholder> => {
  const found = new Set<LegalPlaceholder>()
  const keys = new Set<string>(Object.keys(legalPlaceholders))
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value !== "object" || value === null) return
    const record = value as Record<string, unknown>
    const placeholder = record.placeholder
    if (typeof placeholder === "string" && keys.has(placeholder)) {
      found.add(placeholder as LegalPlaceholder)
      return
    }
    for (const item of Object.values(record)) walk(item)
  }
  walk(document.intro)
  walk(document.sections)
  return found
}
