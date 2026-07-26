import { isSupportedTimeZone } from "@praximo/domain"
import { DefaultTimeZone } from "@praximo/i18n"
import type { CoachSession } from "./coach-session.ts"

/**
 * The coach's zone, or UTC.
 *
 * UTC is the honest fallback rather than a guess: the column is written by the
 * browser on launch, so it is only ever missing for a coach who has not opened
 * the app since #56 shipped, and a wrong guess would move every time on the
 * screen without saying so.
 *
 * The conversions that *use* the zone live in `lib/coach-calendar.ts`, shared
 * with the browser; only this one needs a principal, and a principal is the one
 * thing the browser never holds.
 */
export const zoneOf = (principal: CoachSession.CoachPrincipal): string =>
  principal.timezone !== undefined && isSupportedTimeZone(principal.timezone)
    ? principal.timezone
    : DefaultTimeZone
