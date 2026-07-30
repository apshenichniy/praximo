import { type BusyInterval, isSchedulableStart } from "@praximo/domain"

import { localParts } from "@/lib/coach-calendar.ts"

/**
 * What the reschedule screen has to know about the session it is moving (#62).
 *
 * Both halves exist because a session being moved is **not** an obstacle to
 * itself. The server already knows that — its overlap guard excludes the row it
 * is updating — but the grid the coach picks from is drawn from a day read that
 * knows nothing about the errand, so without this the screen would dim the hour
 * the session already holds and refuse to re-offer the time it is on. Moving a
 * session fifteen minutes later is the commonest reschedule there is.
 *
 * Subtracted here rather than by passing an `excludeSessionId` down through the
 * day reads: those answers are cached per date and shared with the New session
 * screen, so a second meaning for the same key would be either a cache collision
 * or a second dimension on every key.
 */

/** Where a session sits in the coach's own calendar. */
export interface OwnSlot {
  /** `YYYY-MM-DD`, as the coach's calendar reads it. */
  readonly date: string
  readonly startMinutes: number
  readonly durationMinutes: number
}

export const ownSlot = (session: {
  /** ISO string, as it crosses the server-function boundary. */
  readonly scheduledAt: string
  readonly durationMinutes: number
  readonly timezone: string
}): OwnSlot => {
  const here = localParts(new Date(session.scheduledAt), session.timezone)
  return {
    date: here.date,
    startMinutes: here.minutes,
    durationMinutes: session.durationMinutes,
  }
}

/**
 * One day's busy intervals, with the moving session's own removed.
 *
 * Matched on the exact interval rather than on an id, because the day read
 * carries no ids — and it is exact rather than approximate for a reason that
 * holds by constraint: a workspace forbids overlapping live sessions, so no two
 * of them can share a start. Only the session's own day is touched; on any other
 * date this is the identity.
 */
export const withoutOwnSlot = (
  busy: ReadonlyArray<BusyInterval>,
  own: OwnSlot,
  date: string,
): ReadonlyArray<BusyInterval> => {
  if (date !== own.date) return busy
  const end = own.startMinutes + own.durationMinutes
  let removed = false
  return busy.filter((interval) => {
    if (removed) return true
    const mine = interval.startMinutes === own.startMinutes && interval.endMinutes === end
    if (mine) removed = true
    return !mine
  })
}

/**
 * The day the screen opens on, and whether it opens with a time already picked.
 *
 * A session still ahead opens on itself, so the coach sees where it is before
 * choosing where it goes. Two starts are dropped instead, and for the same
 * reason — a screen must never open on a submit the server is bound to refuse:
 *
 * - **a session already in the past.** Nothing writes a terminal state before
 *   #42, so stale bookings accumulate, and moving one forward is exactly the
 *   errand.
 * - **a start that is not on the grid.** No screen can produce one, but the
 *   demo seed does (its offsets are minutes from the run) and so would any row
 *   written by hand — and a session sitting at 11:47 would open on a button
 *   that answers `invalid`.
 */
export const reschedulePrefill = (
  own: OwnSlot,
  todayDate: string,
): { readonly date: string; readonly startMinutes?: number; readonly durationMinutes: number } =>
  own.date < todayDate || !isSchedulableStart(own.startMinutes, own.durationMinutes)
    ? { date: own.date < todayDate ? todayDate : own.date, durationMinutes: own.durationMinutes }
    : { date: own.date, startMinutes: own.startMinutes, durationMinutes: own.durationMinutes }
