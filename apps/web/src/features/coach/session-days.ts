import type { CoachLanguage } from "@praximo/domain"
import { localeTag } from "@praximo/i18n"

import { instantOf, localParts, MinutesInDay } from "@/lib/coach-calendar.ts"

/**
 * How a list of sessions becomes a list of days (#61).
 *
 * Grouping ships with the list rather than after it: three to five sessions a
 * day appear in the first week, and adding grouping to a flat list afterwards
 * means rewriting it. The rule is pure and lives here so it can be tested
 * against a fixed instant — "which day is this on" is exactly the thing that
 * silently goes wrong an offset at a time.
 */

export interface SessionDay<T> {
  /** `YYYY-MM-DD` as the coach's own calendar reads it. */
  readonly date: string
  /** «Today», «Tomorrow», then the weekday and the date. */
  readonly heading: string
  readonly sessions: ReadonlyArray<T>
}

export interface DayWords {
  readonly today: string
  readonly tomorrow: string
}

export interface GroupOptions {
  readonly timezone: string
  readonly language: CoachLanguage
  readonly now: Date
  readonly words: DayWords
}

const headingFormats = new Map<string, Intl.DateTimeFormat>()

const headingFormat = (language: CoachLanguage, timezone: string): Intl.DateTimeFormat => {
  const key = `${language}|${timezone}`
  const found = headingFormats.get(key)
  if (found !== undefined) return found
  const created = new Intl.DateTimeFormat(localeTag(language), {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  headingFormats.set(key, created)
  return created
}

/**
 * The clock a session row shows: 24-hour, in the coach's own zone.
 *
 * Always 24-hour, like every other time this product prints — a coach reading a
 * column of starts is comparing them, and `2:00 PM` is a worse thing to compare
 * than `14:00`.
 */
export const sessionClock = (language: CoachLanguage, timezone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(localeTag(language), {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })

/**
 * Tomorrow, reached through midnight rather than by adding 24 hours.
 *
 * A day is not always 24 hours long where the coach lives, and on the two nights
 * a year it is not, "now plus a day" lands on the wrong date — which would put
 * tomorrow's sessions under a weekday heading while the day before them still
 * says «Tomorrow».
 */
const nextDate = (date: string, timezone: string): string | undefined => {
  const midnight = instantOf(date, MinutesInDay, timezone)
  return midnight === undefined ? undefined : localParts(midnight, timezone).date
}

/**
 * Sessions, in the order they were given, gathered under the day each one falls
 * on where the coach is.
 *
 * The input is assumed sorted — the repository orders by `scheduled_at` and
 * nothing between here and there reorders it — so the groups come out in the
 * same order as the sessions, and a day never appears twice.
 */
export const groupByDay = <T extends { readonly scheduledAt: string }>(
  sessions: ReadonlyArray<T>,
  options: GroupOptions,
): ReadonlyArray<SessionDay<T>> => {
  const todayDate = localParts(options.now, options.timezone).date
  const tomorrowDate = nextDate(todayDate, options.timezone)
  const format = headingFormat(options.language, options.timezone)

  const days: Array<{ date: string; heading: string; sessions: Array<T> }> = []
  for (const session of sessions) {
    const at = new Date(session.scheduledAt)
    const date = localParts(at, options.timezone).date
    const last = days.at(-1)
    if (last !== undefined && last.date === date) {
      last.sessions.push(session)
      continue
    }
    days.push({
      date,
      heading:
        date === todayDate
          ? options.words.today
          : date === tomorrowDate
            ? options.words.tomorrow
            : format.format(at),
      sessions: [session],
    })
  }

  return days
}
