import type { CoachLanguage } from "@praximo/domain"
import { localeTag } from "./locale-tag.ts"

export interface LocaleFormatters {
  /** A moment to the minute — "26 Jul 2026, 14:30". */
  readonly timestamp: (value: string | Date) => string
  /** The day alone, for a value whose time of day carries no meaning. */
  readonly date: (value: string | Date) => string
  /**
   * "2 days ago", in the largest unit that fits.
   *
   * **`undefined` under a minute**, rather than a word for "just now". That word
   * is copy, and copy belongs to a catalogue, not to a formatter — the admin
   * surface says "just now" and the coach surface will say whatever its language
   * says. Returning nothing is how this stays a formatter.
   */
  readonly relative: (value: string | Date, now?: Date) => string | undefined
}

const relativeSteps: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
]

const asDate = (value: string | Date): Date => (value instanceof Date ? value : new Date(value))

const build = (locale: CoachLanguage): LocaleFormatters => {
  const tag = localeTag(locale)
  const timestampFormat = new Intl.DateTimeFormat(tag, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const dateFormat = new Intl.DateTimeFormat(tag, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
  const relativeFormat = new Intl.RelativeTimeFormat(tag, { numeric: "auto" })

  return {
    timestamp: (value) => timestampFormat.format(asDate(value)),
    date: (value) => dateFormat.format(asDate(value)),
    relative: (value, now = new Date()) => {
      const seconds = (now.getTime() - asDate(value).getTime()) / 1000
      for (const [unit, size] of relativeSteps) {
        if (Math.abs(seconds) >= size) {
          return relativeFormat.format(Math.round(-seconds / size), unit)
        }
      }
      return undefined
    },
  }
}

const cache = new Map<CoachLanguage, LocaleFormatters>()

/**
 * The date formatters for one language, built once per locale per process.
 *
 * `Intl` constructors are expensive enough that the admin surface already built
 * its three at module scope; this keeps that property while making the locale a
 * parameter instead of a constant (#130 left `features/admin/formatting.ts`
 * hardcoded to English, which was right for an English-only surface and wrong
 * for everything after it).
 */
export const formatters = (locale: CoachLanguage): LocaleFormatters => {
  const cached = cache.get(locale)
  if (cached !== undefined) return cached
  const created = build(locale)
  cache.set(locale, created)
  return created
}
