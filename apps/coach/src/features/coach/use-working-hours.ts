import type { WorkingHours } from "@praximo/domain"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useRef, useState } from "react"

import { dayScheduleKeys } from "@/features/coach/day-schedule-queries.ts"
import { notifyHaptic } from "@/mini-app.tsx"
import { saveWorkingHours } from "@/server/coach-clients.functions.ts"

/**
 * The week, edited optimistically and committed on every change (#210).
 *
 * There is no Save on either hours screen — the host's back control is
 * permanent chrome, and pairing it with a Save button makes "tap back" a way to
 * destroy an edit silently. So each change paints immediately and is written
 * behind it, which leaves exactly one thing to get right: what happens when the
 * write fails.
 *
 * It **rolls back to the last week the server confirmed** and says so. Leaving
 * the failed value on screen would be worse than the drift it replaces: the
 * coach would go on believing they had narrowed Sunday while the sheet went on
 * offering it.
 *
 * A generation counter guards the rollback against its own lateness. Two quick
 * taps put two writes in flight, and a stale failure must not drag the screen
 * back past a change the coach has since made.
 */
export const useWorkingHoursDraft = (
  /**
   * The week as the server has it, or nothing when it could not be read.
   *
   * `undefined` rather than the default, and the hook hands back `undefined` in
   * turn: a screen that commits on change must not open on a week nobody
   * confirmed, because the first tap would write it over the real one.
   */
  initial: WorkingHours | undefined,
  failedMessage: string,
):
  | {
      readonly hours: WorkingHours
      readonly error: string | undefined
      readonly commit: (next: WorkingHours) => void
    }
  | undefined => {
  const [hours, setHours] = useState(initial)
  const [error, setError] = useState<string>()
  const confirmed = useRef(initial)
  const generation = useRef(0)
  const seeded = useRef(initial)
  const client = useQueryClient()

  /**
   * Re-seed when the week the loader holds changes under us.
   *
   * Everything here commits immediately, so there is never an unsaved edit to
   * protect: a fresher week from the server is always the better one. Without
   * this, coming back from the per-day screen would leave the draft holding the
   * week as it was before those hours were set, and the next tap would commit
   * the stale one over them.
   */
  if (initial !== seeded.current) {
    seeded.current = initial
    confirmed.current = initial
    setHours(initial)
  }

  const commit = useCallback(
    (next: WorkingHours) => {
      const mine = ++generation.current
      setHours(next)
      setError(undefined)
      void saveWorkingHours({ data: { hours: next } })
        .then((result) => {
          if (mine !== generation.current) return
          if (result.ok) {
            confirmed.current = next
            // Every day already in hand was filed under the old week. Left
            // alone it would outlive this change by its whole stale window, so
            // a coach who narrows Saturday and goes straight to the sheet would
            // be offered the hours they just removed.
            void client.invalidateQueries({ queryKey: dayScheduleKeys.all })
            return
          }
          notifyHaptic("error")
          if (confirmed.current !== undefined) setHours(confirmed.current)
          setError(failedMessage)
        })
        .catch(() => {
          if (mine !== generation.current) return
          notifyHaptic("error")
          if (confirmed.current !== undefined) setHours(confirmed.current)
          setError(failedMessage)
        })
    },
    [client, failedMessage],
  )

  return hours === undefined ? undefined : { hours, error, commit }
}
