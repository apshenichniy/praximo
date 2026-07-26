/**
 * The i18n **mechanism**, shared by every Worker that speaks to a human.
 *
 * Catalogues stay where they are consumed — the coach Mini App's words in
 * `apps/web`, the coach-facing bot's in `apps/bot` — because a catalogue is
 * owned by the surface that says it.
 *
 * **One exception, and it earns itself** (#56): the *client-facing* catalogue
 * lives here, because two Workers say the same words. `apps/bot` renders the
 * consent text in the acceptance conversation and `apps/web` renders it again
 * on the Acceptance Page (#57) — and a consent text with two copies is a
 * consent record nobody can reproduce, since the version recorded against a
 * grant is derived from the text itself. The rule still holds for every
 * catalogue with one reader.
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
