import { CoachLanguages } from "@praximo/domain"
import {
  coachTermsFor,
  type LegalDocument,
  type LegalLocale,
  type LegalPlaceholder,
  legalPlaceholders,
  privacyPolicyFor,
} from "@/features/legal/content.ts"

/** The languages both texts are authored in — the product's three. */
const LegalLocales: ReadonlyArray<LegalLocale> = CoachLanguages

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
 * **One version over all three languages** (#130), computed from every locale's
 * text rather than from the English one. Both halves of that matter:
 *
 * - *All three*, so the version answers the question the record is for. A coach
 *   accepted the Ukrainian text; editing one Ukrainian sentence changes what
 *   the next coach reads, and a version derived from English alone would leave
 *   both acceptances claiming the same document.
 * - *One*, because changing language after acceptance must not ask for
 *   re-acceptance. Per-locale versions would make a coach who switches to
 *   Russian carry a version they never agreed to, and there is no re-acceptance
 *   flow to send them through (ADR 0006).
 *
 * A translation edit therefore bumps the version for everybody. That is
 * correct and cheap: `isOnboarded` ignores the version entirely, so nobody is
 * asked to accept anything again — the only effect is that a screen left open
 * across the change is told to reload, which is exactly what it should be told.
 */
const versionOf = (documents: ReadonlyArray<LegalDocument>): string =>
  `${LEGAL_EFFECTIVE_DATE}+${digest(JSON.stringify(documents))}`

const inEveryLanguage = (of: (locale: LegalLocale) => LegalDocument) =>
  LegalLocales.map((locale) => of(locale))

export const TERMS_VERSION = versionOf(inEveryLanguage(coachTermsFor))

/**
 * Exists so the privacy page can display a version and so the column that
 * records one later has a source. Nothing persists it in MVP: a privacy
 * revision is deliberately unrecorded, and `member.terms_version` covers the
 * terms alone (ADR 0006).
 */
export const PRIVACY_VERSION = versionOf(inEveryLanguage(privacyPolicyFor))

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
