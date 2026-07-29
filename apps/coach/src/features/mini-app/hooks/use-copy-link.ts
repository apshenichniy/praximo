import { useEffect, useRef, useState } from "react"

import { notifyHaptic } from "@/presentation-host"

export interface CopyLinkController {
  readonly copied: boolean
  /**
   * A write that was refused, for the caller to say so with.
   *
   * Cleared by the next attempt rather than by a timer: unlike "Copied", which
   * reports something that finished, this reports a state the coach is still in.
   */
  readonly failed: boolean
  readonly copy: () => Promise<void>
  /** Attach to the visible read-only control so a failed clipboard write can select it. */
  readonly fallbackRef: React.RefObject<HTMLInputElement | null>
}

/**
 * Clipboard copy with haptic feedback, a 2s "Copied" flash, and select-fallback.
 *
 * `onCopied` fires only when the clipboard write actually resolved — the
 * select-text fallback is the browser handing the coach a highlighted field and
 * no evidence they did anything with it. That distinction is the whole basis of
 * the delivery record (#224): copying is already the weakest thing that can
 * honestly be observed, and counting a failed copy would make it a fiction.
 *
 * **A refusal now says so.** The select-fallback stays for the two screens that
 * still show a field, but it was never an escape route on its own: it left
 * `copied` false and fired nothing, so the only evidence of a failure was the
 * absence of a success. The client screen has no field to select since the URL
 * left it, and a silent `catch` there would be a dead end wearing no shape at
 * all. `failed` is what the caller renders.
 */
export const useCopyLink = (
  link: string | undefined,
  onCopied?: () => void,
): CopyLinkController => {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const fallbackRef = useRef<HTMLInputElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  const copy = async () => {
    if (link === undefined) return
    setFailed(false)
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), 2000)
      notifyHaptic("success")
      onCopied?.()
    } catch {
      setFailed(true)
      notifyHaptic("error")
      fallbackRef.current?.focus()
      fallbackRef.current?.select()
    }
  }

  return { copied, failed, copy, fallbackRef }
}
