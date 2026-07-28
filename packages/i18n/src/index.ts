/**
 * The i18n **mechanism**, shared by every Worker that speaks to a human.
 *
 * Catalogues stay where they are consumed — the coach Mini App's words in
 * the product apps, the coach-facing bot's in `apps/bot` — because a catalogue is
 * owned by the surface that says it.
 *
 * **One exception, and it earns itself twice** (#56, #191): a text whose
 * *version is recorded against a person* cannot have two copies, because the
 * version is derived from the text itself and a second copy makes the record
 * unreproducible. Two texts are in that position, and both live here:
 *
 * - the *client-facing* catalogue — `apps/bot` renders the consent text in the
 *   acceptance conversation and `apps/client` renders it again on the
 *   Acceptance Page (#57);
 * - the *legal* texts under `./legal` — `apps/client` renders them at
 *   `me.praximo.io/legal/*`, while the Coach server derives `TERMS_VERSION`
 *   from them and writes it to `member.terms_version` on acceptance. Apps never
 *   import apps (ADR 0002), so the surface that shows a contract and the
 *   surface that records agreeing to it can only share it through here.
 *
 * The rule still holds for every catalogue with one reader.
 *
 * What is otherwise shared is everything around them:
 * how a gap is filled, how a count agrees with its noun, how a moment is written
 * in a given language, and how a text is versioned from its own content.
 *
 * There is deliberately **no i18n library** underneath. Extracting strings into
 * `.po` / `.json` is what i18next and Lingui are for, and there is nobody to
 * extract them for: the strings are written by the owner and by agents, in this
 * repository. What the mechanism has instead is what a library cannot give
 * without codegen — a typed catalogue interface, so a key missing from one
 * locale fails the build.
 */
export {
  CLIENT_CONSENT_EFFECTIVE_DATE,
  type ClientCopy,
  ClientLanguageNames,
  clientConsentText,
  clientConsentVersion,
  clientConsentVersions,
  clientCopy,
  type ConfirmationInput,
  SuggestedLanguageMark,
} from "./client-copy.ts"
export { contentDigest } from "./digest.ts"
/**
 * The two legal texts and the versions derived from them.
 *
 * The authoring helpers (`p`, `ul`, `b`, `ph`) are deliberately **not** here:
 * they are how the three language files are written, not how a reader consumes
 * them, and names that short have no business in a package's public surface.
 */
export {
  coachTermsFor,
  LEGAL_PATHS,
  type LegalBlock,
  type LegalDocument,
  type LegalInline,
  type LegalLocale,
  type LegalPlaceholder,
  legalPlaceholders,
  type LegalSection,
  privacyPolicyFor,
} from "./legal/content.ts"
export { legalUrl, type LegalDocumentName } from "./legal/url.ts"
export { PRIVACY_VERSION, TERMS_VERSION } from "./legal/versions.ts"
export { DefaultTimeZone, type SessionMoment, sessionMoment } from "./session-time.ts"
export {
  type CatalogueConfig,
  fillGaps,
  type FillGapsOptions,
  makeCatalogue,
  MissingTranslation,
} from "./gaps.ts"
export { formatters, type LocaleFormatters } from "./formatting.ts"
export { localeTag } from "./locale-tag.ts"
export { plural, type PluralForms } from "./plural.ts"
