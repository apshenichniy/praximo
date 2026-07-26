import { useEffect } from "react"

import { saveTimezone } from "@/server/coach-clients.functions.ts"

/**
 * Report the browser's zone on launch, and only when it has changed (#56).
 *
 * No UI, and nothing on screen waits for the answer: this is the precondition
 * for the *bot* being able to print "10:00 (UTC+3)" at all, since it renders
 * that in a Worker where `Intl…resolvedOptions()` knows nothing about the coach.
 * A write that fails simply happens again on the next launch.
 *
 * It lives in a hook rather than in one route because a coach can land on any
 * of them — the client-accepted push opens a client's route directly, and a
 * coach who only ever arrives that way would otherwise never write a zone.
 */
export const useCoachTimezone = (enabled: boolean): void => {
  useEffect(() => {
    if (!enabled) return
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (typeof timezone !== "string" || timezone.length === 0) return
    void saveTimezone({ data: { timezone } }).catch(() => undefined)
  }, [enabled])
}
