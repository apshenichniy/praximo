import { narrowCoachLanguage } from "@praximo/domain"
import type { LegalLocale } from "@praximo/i18n"

export interface LegalSearch {
  readonly lang: LegalLocale
}

/**
 * Which language a legal text opens in.
 *
 * These two routes are public — nobody is signed in while deciding whether to
 * sign in, and a client will read the policy from the consent page under no
 * credential at all — so they cannot read `member.language`. The language
 * therefore travels in the link: the coach screen that sends them here knows
 * what the coach chose, and by then that choice is already persisted, so the two
 * cannot disagree.
 *
 * Without the parameter — a bookmark, a link pasted to somebody — the reader's
 * own Telegram client language decides, and English is the floor.
 */
export const validateLegalSearch = (search: Record<string, unknown>): LegalSearch => ({
  lang: narrowCoachLanguage(typeof search.lang === "string" ? search.lang : undefined),
})
