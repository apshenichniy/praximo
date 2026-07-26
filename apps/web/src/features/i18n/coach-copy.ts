import { type CoachLanguage, CoachLanguages, DefaultCoachLanguage } from "@praximo/domain"
import { fillGaps as fillGapsWith, makeCatalogue, MissingTranslation } from "@praximo/i18n"
import { clients, type ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { common, type CommonCopy } from "@/features/i18n/coach-copy/common.ts"
import { entry, type EntryCopy } from "@/features/i18n/coach-copy/entry.ts"
import { home, type HomeCopy } from "@/features/i18n/coach-copy/home.ts"
import {
  language,
  type LanguageCopy,
  languageNames,
  terms,
  type TermsCopy,
} from "@/features/i18n/coach-copy/onboarding.ts"

/**
 * Every word the coach Mini App says, in the three languages the product speaks
 * (#130).
 *
 * The catalogue is data rather than components because the language is chosen at
 * runtime by the coach and read from `member.language` on every launch: a screen
 * that hard-coded English would have to be rewritten to translate, which is
 * exactly how the trilingual bot catalogue ended up with three quarters of its
 * copy unreachable.
 *
 * Sentences that wrap something the app supplies — the coach's bot username, the
 * name of the language itself — are split into their own fields rather than
 * assembled from a template. Word order differs between these three languages,
 * and a placeholder in the middle of a string is a translation waiting to read
 * backwards.
 *
 * **This file is the composition, not the words.** Each surface owns its slice
 * under `coach-copy/`, and the interface below is assembled from theirs, because
 * the client list and the schedule are about to take this past a thousand lines
 * (#56, #61). The mechanism — gap filling, the `MissingTranslation` marker —
 * lives in `@praximo/i18n`, shared with the bot.
 */
export interface CoachCopy {
  readonly common: CommonCopy
  readonly entry: EntryCopy
  readonly language: LanguageCopy
  readonly terms: TermsCopy
  readonly home: HomeCopy
  readonly clients: ClientsCopy
}

export { languageNames, MissingTranslation }

/** What a gap falls back to, and the language every catalogue is filled out against. */
export const FallbackLanguage: CoachLanguage = DefaultCoachLanguage

const compose = (locale: CoachLanguage): CoachCopy => ({
  common: common[locale],
  entry: entry[locale],
  language: language[locale],
  terms: terms[locale],
  home: home[locale],
  clients: clients[locale],
})

/**
 * English is the reference, not merely one of three: it is the shape every
 * other catalogue is filled out against, and the value a gap falls back to.
 */
export const coachCatalog: Record<CoachLanguage, CoachCopy> = Object.fromEntries(
  CoachLanguages.map((locale) => [locale, compose(locale)]),
) as Record<CoachLanguage, CoachCopy>

const CatalogueFile = "features/i18n/coach-copy/"

/**
 * Fill one catalogue out against English, leaf by leaf.
 *
 * A thin binding of the shared walk to this app's build: strict in development,
 * so a blank throws where it happens, and forgiving in production, because a
 * coach reading one English sentence in a Ukrainian screen is a smaller failure
 * than a coach reading `terms.points.3`. The package takes strictness as an
 * argument rather than reading `import.meta.env` itself — that global is Vite's,
 * and `apps/bot` is bundled by wrangler.
 *
 * Exported for the test that pins both halves of that split — the behaviour is
 * conditional on the build, so a test has to be able to call it directly.
 */
export const fillGaps = <T>(reference: T, translation: T, locale: CoachLanguage, path = ""): T =>
  fillGapsWith(reference, translation, locale, {
    strict: import.meta.env.DEV,
    where: CatalogueFile,
    path,
  })

const resolve = makeCatalogue<CoachCopy>({
  reference: FallbackLanguage,
  byLocale: coachCatalog,
  strict: import.meta.env.DEV,
  where: CatalogueFile,
})

/**
 * The coach Mini App's words in one language. Resolved once per locale per
 * process — the catalogues are constants, so the fallback walk cannot produce a
 * different answer the second time.
 */
export const coachCopy = (locale: CoachLanguage): CoachCopy => resolve(locale)
