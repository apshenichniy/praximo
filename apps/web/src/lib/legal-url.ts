import type { CoachLanguage } from "@praximo/domain"
import { LEGAL_PATHS } from "@praximo/i18n"

/** Which of the two texts. The keys `LEGAL_PATHS` is written in. */
export type LegalDocumentName = keyof typeof LEGAL_PATHS

/**
 * A legal text's address on the client app, in a given language.
 *
 * These pages left this Worker in #191 — they are served from `my.praximo.io`
 * now — so every link to them is external and every one of them is built from
 * configuration rather than from a string in the source. There are exactly two
 * callers, and they are the two halves of the same move: the coach's onboarding
 * summary, which links out, and the redirect that keeps the old URLs alive.
 *
 * Total. A malformed origin falls back to plain concatenation rather than
 * throwing: a coach reading the terms they are about to accept must not meet an
 * exception because a binding was set to something odd, and the redirect route
 * checks its own origin before it gets here.
 */
export const legalUrl = (
  origin: string,
  document: LegalDocumentName,
  language: CoachLanguage,
): string => {
  const path = LEGAL_PATHS[document]
  try {
    const url = new URL(path, origin)
    url.searchParams.set("lang", language)
    return url.toString()
  } catch {
    return `${origin.replace(/\/+$/, "")}${path}?lang=${language}`
  }
}
