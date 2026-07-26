/**
 * Which days the scheduling screen offers at a glance (#186).
 *
 * The month used to sit open above the slots and fold itself into a one-line
 * summary the moment a day was picked — 320px of layout vanishing under the
 * coach's thumb, taking the slot grid with it. A strip of days is the same
 * choice at a constant height: nothing moves when a day is chosen, so the time
 * grid below it stays where the eye left it. The month is still there, behind a
 * control, for the booking that is weeks out.
 *
 * Pure and here rather than in the component because "which days are on the
 * strip" is the part that can be wrong — around today, around a day chosen from
 * the month, and around the end of a month or a year.
 */

/** How many days the strip opens with, and grows by. Two weeks of thumb travel. */
export const StripDays = 14

/**
 * Where the strip stops growing — a quarter out.
 *
 * The scroll promises more days, so it hands them over; what it must not become
 * is a way to thumb through a year one day at a time. Past this the month is
 * simply the better instrument, and the strip ends in a control that opens it
 * rather than in a wall.
 */
export const StripHorizon = 90

/** One more fortnight, up to the horizon. */
export const extendStrip = (length: number): number => Math.min(length + StripDays, StripHorizon)

/** Midnight, locally — the strip compares days, never instants. */
const startOfDay = (day: Date): Date => new Date(day.getFullYear(), day.getMonth(), day.getDate())

/**
 * Calendar arithmetic rather than instant arithmetic: a day is not always 24
 * hours long where the coach lives, and on the two nights a year it is not,
 * "plus 24 hours" lands on the wrong date.
 */
export const addDays = (day: Date, count: number): Date => {
  const at = startOfDay(day)
  at.setDate(at.getDate() + count)
  return at
}

export const sameDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate()

/**
 * The first day on the strip.
 *
 * Today, while the chosen day is within reach of it — so the strip does not
 * drift as the coach taps along it. A day chosen from the month is usually
 * further out than that, and lands one day in, so it arrives with a neighbour
 * on each side rather than pinned to the left edge.
 */
export const stripAnchor = (today: Date, selected: Date, length = StripDays): Date => {
  const start = startOfDay(today)
  const chosen = startOfDay(selected)
  if (chosen.getTime() <= start.getTime()) return start
  return chosen.getTime() < addDays(start, length).getTime() ? start : addDays(chosen, -1)
}

/** The strip itself: `length` days from the anchor, the chosen day among them. */
export const stripWindow = (
  today: Date,
  selected: Date,
  length = StripDays,
): ReadonlyArray<Date> => {
  const anchor = stripAnchor(today, selected, length)
  return Array.from({ length }, (_, index) => addDays(anchor, index))
}
