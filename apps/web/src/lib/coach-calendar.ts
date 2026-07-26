import { DateTime, Option } from "effect"

/**
 * The coach's calendar: the two conversions between an instant and the wall
 * clock they read it on.
 *
 * In `lib` rather than beside either caller because **both sides need the same
 * answer**. The server brackets a day to query it — the sheet's grid (#56),
 * Today's own day (#61) — and the browser reads the same day back out to group a
 * list under it. A second copy of "which day is this instant on where the coach
 * is" is how a session ends up on Monday's query and under Tuesday's heading.
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

/** Which minute of which day an instant falls on, read in the coach's zone. */
export const localParts = (
  at: Date,
  timezone: string,
): { readonly date: string; readonly minutes: number } => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00"
  const hour = Number(value("hour")) % 24
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: hour * 60 + Number(value("minute")),
  }
}
