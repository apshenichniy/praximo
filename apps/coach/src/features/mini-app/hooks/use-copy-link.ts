import { useEffect, useRef, useState } from "react"

import { notifyHaptic } from "@/presentation-host"

export interface CopyLinkController {
  readonly copied: boolean
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
 */
export const useCopyLink = (
  link: string | undefined,
  onCopied?: () => void,
): CopyLinkController => {
  const [copied, setCopied] = useState(false)
  const fallbackRef = useRef<HTMLInputElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  const copy = async () => {
    if (link === undefined) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), 2000)
      notifyHaptic("success")
      onCopied?.()
    } catch {
      fallbackRef.current?.focus()
      fallbackRef.current?.select()
    }
  }

  return { copied, copy, fallbackRef }
}
