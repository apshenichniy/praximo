import type { CoachLanguage } from "@praximo/domain"
import { localeTag } from "./locale-tag.ts"

/**
 * A session's moment, written for somebody who is not in the coach's calendar.
 *
 * The client is shown **the coach's zone**, named as an offset — `UTC+3` — and
 * that offset is computed **on the session's own date**, never on today. A
 * session booked in July for October otherwise slips by an hour across the
 * daylight-saving change, in a message the client will act on and nobody will
 * re-read (#56).
 */
export interface SessionMoment {
  /** "Monday, 4 August" — the weekday leads, because that is what people plan by. */
  readonly day: string
  /** "10:00", always 24-hour: an offset beside a 12-hour clock is unreadable. */
  readonly time: string
  /** "UTC+3" — the coach's zone as the client can act on it. */
  readonly offset: string
}

const dayFormats = new Map<string, Intl.DateTimeFormat>()
const timeFormats = new Map<string, Intl.DateTimeFormat>()
const offsetFormats = new Map<string, Intl.DateTimeFormat>()

const cached = (
  cache: Map<string, Intl.DateTimeFormat>,
  key: string,
  build: () => Intl.DateTimeFormat,
): Intl.DateTimeFormat => {
  const found = cache.get(key)
  if (found !== undefined) return found
  const created = build()
  cache.set(key, created)
  return created
}

/**
 * `GMT+03:00` as `UTC+3`.
 *
 * Trailing `:00` is dropped because nobody writes their zone that way, while a
 * half-hour zone keeps its minutes. Plain `GMT` — the zone that *is* UTC —
 * becomes `UTC`, with no sign at all.
 */
const readOffset = (formatted: string): string => {
  const raw = formatted.replace("GMT", "").trim()
  const [hours, minutes] = raw.split(":")
  const hour = (hours ?? "").replace(/^([+-])0(\d)/, "$1$2")
  // Zero offset is "UTC", not "UTC+0": a sign in front of nothing reads as a
  // rendering bug, and this is the zone every workspace falls back to.
  if (raw.length === 0 || ((hour === "+0" || hour === "-0") && (minutes ?? "00") === "00")) {
    return "UTC"
  }
  return minutes === undefined || minutes === "00" ? `UTC${hour}` : `UTC${hour}:${minutes}`
}

export const sessionMoment = (locale: CoachLanguage, at: Date, timeZone: string): SessionMoment => {
  const tag = localeTag(locale)
  const key = `${tag}|${timeZone}`

  const day = cached(
    dayFormats,
    key,
    () =>
      new Intl.DateTimeFormat(tag, { timeZone, weekday: "long", day: "numeric", month: "long" }),
  ).format(at)

  const time = cached(
    timeFormats,
    key,
    () =>
      new Intl.DateTimeFormat(tag, { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }),
  ).format(at)

  const offsetParts = cached(
    offsetFormats,
    key,
    () => new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }),
  ).formatToParts(at)
  const offset = offsetParts.find((part) => part.type === "timeZoneName")?.value ?? "GMT"

  return { day, time, offset: readOffset(offset) }
}

/** What the app falls back to before a coach's first launch has written a zone. */
export const DefaultTimeZone = "UTC"
