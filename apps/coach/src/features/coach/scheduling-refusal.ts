import type { CoachCopy } from "@/features/i18n/coach-copy.ts"

/**
 * Why a booking or a move did not happen, as the sentence the coach reads.
 *
 * Written once because both writes refuse in the same words for the same three
 * reasons, and because a fourth reason will arrive with a fourth screen. Two
 * hand-copied ternary cascades is exactly the drift `sessionDraft` was extracted
 * to prevent one layer down — the server agreeing on what `invalid` means is
 * worth little if the screens then say different things about it.
 *
 * `gone` is deliberately absent: it is not a sentence, it is a *navigation* —
 * the session moved on underneath the coach, and what they need next is the
 * screen that says what it moved on to.
 */
export type SchedulingRefusal = "overlap" | "past" | "invalid" | "failed"

export const schedulingRefusal = (copy: CoachCopy, reason: SchedulingRefusal): string => {
  if (reason === "overlap") return copy.clients.overlapError
  if (reason === "past") return copy.clients.pastError
  if (reason === "invalid") return copy.clients.invalidError
  return copy.common.failed
}
