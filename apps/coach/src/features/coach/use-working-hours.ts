import type { WorkingHours } from "@praximo/domain"
import { useCallback, useRef, useState } from "react"

import { notifyHaptic } from "@/presentation-host"
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
  initial: WorkingHours,
  failedMessage: string,
): {
  readonly hours: WorkingHours
  readonly error: string | undefined
  readonly commit: (next: WorkingHours) => void
} => {
  const [hours, setHours] = useState(initial)
  const [error, setError] = useState<string>()
  const confirmed = useRef(initial)
  const generation = useRef(0)

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
            return
          }
          notifyHaptic("error")
          setHours(confirmed.current)
          setError(failedMessage)
        })
        .catch(() => {
          if (mine !== generation.current) return
          notifyHaptic("error")
          setHours(confirmed.current)
          setError(failedMessage)
        })
    },
    [failedMessage],
  )

  return { hours, error, commit }
}
