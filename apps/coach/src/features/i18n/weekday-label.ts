import { type CoachLanguage, type Weekday, Weekdays } from "@praximo/domain"
import { localeTag } from "@praximo/i18n"

/**
 * A weekday's name, declined by `Intl` rather than translated by hand (#210).
 *
 * Fourteen hand-written strings across three languages is fourteen chances to
 * ship the wrong form, and the platform already holds every one of them — the
 * scheduling strip and the month have been reading weekdays out of `Intl` since
 * #56. The reference week is a real one so the formatter has a date to decline:
 * 1 January 2024 was a Monday, and `Weekdays` starts there too.
 */
const MondayUtc = Date.UTC(2024, 0, 1)
const DayMillis = 24 * 60 * 60 * 1000

export const weekdayLabel = (
  language: CoachLanguage,
  weekday: Weekday,
  style: "short" | "long" = "short",
): string =>
  new Intl.DateTimeFormat(localeTag(language), { weekday: style, timeZone: "UTC" }).format(
    new Date(MondayUtc + Weekdays.indexOf(weekday) * DayMillis),
  )
