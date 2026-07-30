import type { CoachLanguage } from "@praximo/domain"
import { localeTag } from "@praximo/i18n"

import { localParts, nextDate } from "@/lib/coach-calendar.ts"

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
  /**
   * Absent where a list runs backwards (#232). «Завтра» over a group of
   * sessions that are *over* is a contradiction — a cancellation booked for
   * next week is history the moment it is written, and in reverse chronology it
   * sits at the very top. «Сегодня» has no such problem: a session called off
   * this morning is still today's.
   */
  readonly tomorrow?: string
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
  const tomorrowDate = nextDate(todayDate)
  const format = headingFormat(options.language, options.timezone)
  // `YYYY-MM-DD` in the coach's zone, so a session at 01:30 on 1 January is
  // theirs to place even while UTC is still on 31 December.
  const thisYear = todayDate.slice(0, 4)

  /**
   * The date, **with its year only when that year is not the current one**
   * (#232).
   *
   * Upcoming barely needed this — a coach books months ahead, not years — but
   * Past walks backwards without a floor, and «понедельник, 3 августа» in a list
   * that reaches into last year is a date nobody can place. Printing it on every
   * heading would be the opposite mistake: a year the reader already knows, on
   * every group, is noise the eye learns to skip.
   *
   * Appended rather than asked of `Intl`, which reshapes the whole pattern once
   * `year` is in the options — `Thursday 30 July` becomes `Monday, 4 August
   * 2025` — so two headings in one list would be punctuated differently. The
   * year goes last in all three languages this app speaks.
   */
  const dateHeading = (at: Date, date: string): string => {
    const year = date.slice(0, 4)
    return year === thisYear ? format.format(at) : `${format.format(at)} ${year}`
  }

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
          : ((date === tomorrowDate ? options.words.tomorrow : undefined) ?? dateHeading(at, date)),
      sessions: [session],
    })
  }

  return days
}

/**
 * The days a client is already booked on, as the coach's own calendar reads them
 * — the dots on the scheduling sheet's month (#61).
 *
 * Here rather than in either route because **both entrances draw the same
 * month**: the client route holds these sessions already, and the picker path
 * reads the same client before the sheet opens.
 *
 * It reads `sessions` and deliberately not the history beside it (#232): the
 * dots exist so a coach can place a rhythm, the grid refuses a day that has
 * gone, and a dot on a day nothing can be booked on is noise.
 */
export const bookedDates = (client: {
  readonly timezone: string
  readonly sessions: ReadonlyArray<{ readonly scheduledAt: string }>
}): ReadonlyArray<string> =>
  client.sessions.map((session) => localParts(new Date(session.scheduledAt), client.timezone).date)

/**
 * Whether the session about to be booked is this client's first — what turns the
 * intake switch on before the coach has touched it (#61).
 *
 * **Both fields, and that is the fix** (#232). It used to ask only whether
 * anything was scheduled ahead, which is true of a client seen weekly for a year
 * and rebooking after a gap: the screen opened with «Первая сессия» on, and the
 * debrief prompt it drives would have treated a long engagement as a first
 * meeting. A history is exactly the evidence that this is not one.
 */
export const firstSessionFor = (client: {
  readonly sessions: ReadonlyArray<unknown>
  readonly past: ReadonlyArray<unknown>
}): boolean => client.sessions.length === 0 && client.past.length === 0
