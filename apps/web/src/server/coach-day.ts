import { isSupportedTimeZone } from "@praximo/domain"
import { DefaultTimeZone } from "@praximo/i18n"
import { DateTime, Option } from "effect"
import type { CoachSession } from "./coach-session.ts"

/**
 * Bracketing a coach's day, server-side.
 *
 * Here rather than in `lib` because of what it costs to be here: `DateTime` is
 * Effect's, and in `apps/web` Effect runs server-side only (ADR 0002 §Effect
 * conventions). The browser needs the *other* direction — an instant to the day
 * it falls on — which is pure `Intl` and lives in `lib/coach-calendar.ts`.
 */

export const MinutesInDay = 24 * 60

/**
 * The instant a wall-clock minute-of-day names in the coach's own zone.
 *
 * `toDateUtc`, never `toDate`: the latter hands back the *reading* — 10:00 in
 * Kyiv as `10:00Z` — which would store every session off by the coach's offset
 * and make the day window query the wrong day.
 */
export const instantOf = (
  date: string,
  startMinutes: number,
  timezone: string,
): Date | undefined => {
  const hours = String(Math.floor(startMinutes / 60)).padStart(2, "0")
  const minutes = String(startMinutes % 60).padStart(2, "0")
  const zoned = DateTime.makeZoned(`${date}T${hours}:${minutes}:00`, {
    timeZone: timezone,
    adjustForTimeZone: true,
  })
  return Option.isSome(zoned) ? DateTime.toDateUtc(zoned.value) : undefined
}

/**
 * The coach's zone, or UTC.
 *
 * UTC is the honest fallback rather than a guess: the column is written by the
 * browser on launch, so it is only ever missing for a coach who has not opened
 * the app since #56 shipped, and a wrong guess would move every time on the
 * screen without saying so.
 */
export const zoneOf = (principal: CoachSession.CoachPrincipal): string =>
  principal.timezone !== undefined && isSupportedTimeZone(principal.timezone)
    ? principal.timezone
    : DefaultTimeZone
