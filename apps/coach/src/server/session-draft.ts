import { isSchedulableStart } from "@praximo/domain"
import { instantOf } from "./coach-day.ts"

/**
 * When a session is being put, decided once for both writes that put one (#62).
 *
 * Booking and rescheduling ask the same three questions of a date, a
 * minute-of-day and a length — is this start on the grid, does that wall-clock
 * time name a real instant in the coach's zone, and has it already gone by — and
 * the answers have to be the same. Two copies of them is how `invalid` comes to
 * mean one thing on the New session screen and another on the reschedule screen,
 * with only a coach to notice.
 *
 * What is deliberately *not* here: overlap. It needs the workspace's other
 * bookings and is refused by the statement that writes (`SessionRepo`), because
 * a check performed here would be a read followed by a write with a race between
 * them. This module decides everything a single draft can be wrong about on its
 * own, and nothing that depends on anything else.
 */

export type SessionDraft =
  | { readonly ok: true; readonly at: Date }
  | { readonly ok: false; readonly reason: "invalid" | "past" }

export interface SessionDraftInput {
  /** `YYYY-MM-DD`, in the coach's own calendar. */
  readonly date: string
  readonly startMinutes: number
  readonly durationMinutes: number
  readonly timezone: string
  /** The instant the request is being decided at, as epoch milliseconds. */
  readonly nowMillis: number
}

/**
 * `<=` rather than `<` on the past check: a start exactly now is a session the
 * coach is already late for, and the screen never offers one — `nextSlotStart`
 * moves the first offered slot strictly past the current minute.
 */
export const sessionDraft = (input: SessionDraftInput): SessionDraft => {
  if (!isSchedulableStart(input.startMinutes, input.durationMinutes)) {
    return { ok: false, reason: "invalid" }
  }

  const at = instantOf(input.date, input.startMinutes, input.timezone)
  if (at === undefined) return { ok: false, reason: "invalid" }
  if (at.getTime() <= input.nowMillis) return { ok: false, reason: "past" }

  return { ok: true, at }
}
