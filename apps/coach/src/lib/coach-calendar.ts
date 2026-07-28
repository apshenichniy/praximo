/**
 * The coach's calendar as the **browser** reads it: which day an instant falls
 * on where the coach is, and what the day after that is called.
 *
 * In `lib` rather than beside either caller because both sides need the same
 * answer. The server brackets a day to query it — the sheet's grid (#56),
 * Today's own day (#61) — and the browser reads the same day back out to group a
 * list under it. A second copy of "which day is this instant on where the coach
 * is" is how a session ends up on Monday's query and under Tuesday's heading.
 *
 * **Effect-free, deliberately** (ADR 0002 §Effect conventions: in Coach,
 * Effect runs server-side only and client React stays Effect-free). The other
 * half of the conversion — a wall-clock minute back to an instant — needs
 * `DateTime`'s zone arithmetic and therefore lives in `server/coach-day.ts`,
 * where nothing in the browser can reach it.
 */

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

/**
 * The calendar day after this one.
 *
 * Pure date arithmetic on the label, never "the instant plus 24 hours": a day is
 * not always 24 hours long where the coach lives, and on the two nights a year
 * it is not, adding a day to an instant lands on the wrong date — which would
 * label the day *after* tomorrow «Tomorrow». Calendar days have no such problem:
 * the 25th is followed by the 26th in every zone there is.
 */
export const nextDate = (date: string): string => shiftDate(date, 1)

/** The calendar day before this one, on the same terms as `nextDate`. */
export const previousDate = (date: string): string => shiftDate(date, -1)

/** The calendar day `days` from this one, in either direction. */
export const shiftDate = (date: string, days: number): string => {
  const at = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(at.getTime())) return date
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}
