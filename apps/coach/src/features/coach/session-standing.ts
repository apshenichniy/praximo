import type { SessionCancelReason, SessionState } from "@praximo/domain"

import type { SessionsCopy } from "@/features/i18n/coach-copy/sessions.ts"

/**
 * What became of a session, as a sentence — the one place three surfaces read it
 * from (#232).
 *
 * It was module-private on the session screen until history existed (#62). Now
 * the same words appear on the sessions list's Past view and on a client's own
 * route, and three copies of a rule this small is exactly how «Отменена вами»
 * and «Отменена: никто не пришёл» start disagreeing about the same row.
 *
 * `undefined` for a session still scheduled — which is what keeps the line off
 * an ordinary screen — and for `in_progress`, whose whole story is happening in
 * the room right now and belongs to #42 rather than to a past-tense line. A Past
 * row can carry a `scheduled` session, because until #42's reconciler exists
 * that is what every conducted session still looks like; it prints no sentence,
 * which is the honest answer — nothing has claimed anything about it yet.
 */
export const stateSentence = (
  copy: SessionsCopy,
  state: SessionState,
  reason: SessionCancelReason | undefined,
): string | undefined => {
  if (state === "completed") return copy.stateCompleted
  if (state !== "cancelled") return undefined
  // A cancellation with no reason on file cannot exist — every writer sets one —
  // but reading an unknown one as the reconciler's would put words in its mouth,
  // so anything else falls back to the coach's own.
  if (reason === "no_show") return copy.stateCancelledNoShow
  if (reason === "room_unavailable") return copy.stateCancelledRoom
  return copy.stateCancelledByCoach
}
