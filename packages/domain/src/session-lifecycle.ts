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
