/**
 * What a session *is* at any moment, and why it stopped being scheduled.
 *
 * Its own module rather than more of `scheduling.ts`: that one holds the rules
 * the scheduling screen is built from — which starts exist, how long a session
 * may run — and none of its readers care what became of a session afterwards.
 * These are read by the screen that shows one session, by the repository that
 * writes the transition, and by #42's reconciler; the sheet never asks.
 *
 * Types and two constants, and deliberately **no `Schema`**. Every other closed
 * set in this package carries one because something decodes it at a boundary;
 * these cross no boundary a browser can forge — they are read out of our own
 * `pgEnum` columns and written by our own statements. A schema with no decoder
 * is an export waiting to be used for the wrong thing.
 */

/**
 * The lifecycle, and the whole of it (`web-room-sessions.md`).
 *
 * Only two of the four transitions have a writer in MVP: the coach writes
 * `cancelled` with `coach_cancelled` (#62), and the reconciler writes everything
 * else (ADR 0005). `in_progress` is set exactly once, at joint join.
 */
export const SessionStates = ["scheduled", "in_progress", "completed", "cancelled"] as const
export type SessionState = (typeof SessionStates)[number]

/** The states that hold a slot — the only two that can be in a coach's way. */
export const LiveSessionStates = [
  "scheduled",
  "in_progress",
] as const satisfies ReadonlyArray<SessionState>

/**
 * Why a session was cancelled.
 *
 * `coach_cancelled` is the only one a human writes. The other two are the
 * reconciler's, which is why there is no «mark no-show» control anywhere: a
 * terminal state a coach can assert is a terminal state that can disagree with
 * what the web room actually observed.
 */
export const SessionCancelReasons = ["coach_cancelled", "no_show", "room_unavailable"] as const
export type SessionCancelReason = (typeof SessionCancelReasons)[number]

/**
 * Whether a session still lies ahead of `floor` — the rule the two views of the
 * calendar are cut along (#232), and the *only* one.
 *
 * Upcoming and Past are complements rather than two filters that happen to
 * disagree nowhere: a session this calls ahead belongs to Upcoming, and
 * everything else is history. That is what stops a row falling between them —
 * and until #42's reconciler exists, every conducted session is exactly such a
 * row, still `scheduled` and long over.
 *
 * Two conditions and each is doing its own work. **A live state** is what still
 * holds a slot, so a cancellation booked for next week is history the moment it
 * is written: it is what happened, and it will not happen. **The floor** is the
 * caller's, because the two surfaces mean different things by "now" — the flat
 * list starts at the beginning of the coach's own today, so a session that began
 * twenty minutes ago is still on it, while a client's route asks from this
 * minute.
 */
export const sessionStillAhead = (state: SessionState, scheduledAt: Date, floor: Date): boolean =>
  (LiveSessionStates as ReadonlyArray<SessionState>).includes(state) &&
  scheduledAt.getTime() >= floor.getTime()
