import { useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

export interface UnsavedChangesGuard {
  /** Leave immediately when clean; open the discard dialog when dirty. */
  readonly requestBack: () => void
  readonly confirmOpen: boolean
  readonly setConfirmOpen: (open: boolean) => void
  /** Discard confirmed from the dialog: close it and navigate back. */
  readonly confirmDiscard: () => void
}

/**
 * Back-navigation guard for dirty forms. `beforeunload` stays as a best-effort
 * browser fallback; the in-app dialog is the reliable path because Telegram
 * webviews often ignore both `beforeunload` and `window.confirm`.
 */
export const useUnsavedChanges = (isDirty: () => boolean): UnsavedChangesGuard => {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current()) return
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [])

  const requestBack = useCallback(() => {
    if (isDirtyRef.current()) {
      setConfirmOpen(true)
      return
    }
    router.history.back()
  }, [router])

  const confirmDiscard = useCallback(() => {
    setConfirmOpen(false)
    router.history.back()
  }, [router])

  return { requestBack, confirmOpen, setConfirmOpen, confirmDiscard }
}
