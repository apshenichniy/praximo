import type { CoachLanguage } from "@praximo/domain"

import { LEGAL_PATHS } from "./document.ts"

/** Which of the two texts. The keys `LEGAL_PATHS` is written in. */
export type LegalDocumentName = keyof typeof LEGAL_PATHS

/**
 * A legal text's address on the client app, in a given language.
 *
 * Here rather than in either app because three callers in two Workers build it
 * (#191): the coach's onboarding summary links out to it, and Coach redirects
 * the old addresses to it, and the bot puts the privacy policy on a consent
 * button. The bot used to write `/legal/privacy` as a literal while depending on
 * this very package — one rename away from a dead link in a consent flow.
 *
 * Built by hand rather than through `URL`, and the constraint turns out to be
 * the better design. This package is typechecked against `lib: ES2022` with no
 * DOM (ADR 0002 — packages carry no runtime assumptions), so `URL` is not
 * declared here. It was never load-bearing: the path comes from `LEGAL_PATHS`
 * and the language is one of three literals, so there is nothing to
 * percent-encode and nothing that can throw. What is left is what the callers
 * actually need — drop whatever the origin carried, and join once.
 *
 * Dropping the origin's own query and fragment is deliberate. These are public
 * pages, and the bot builds this from a URL that may carry `?b=<botId>`: a
 * consent button that forwarded it would say something about who was sent it.
 */
export const legalUrl = (
  origin: string,
  document: LegalDocumentName,
  language: CoachLanguage,
): string => {
  const bare = origin.split(/[?#]/)[0] ?? ""
  return `${bare.replace(/\/+$/, "")}${LEGAL_PATHS[document]}?lang=${language}`
}
