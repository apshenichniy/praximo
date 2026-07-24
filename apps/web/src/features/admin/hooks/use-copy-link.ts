import { useEffect, useRef, useState } from "react"

import { notifyHaptic } from "@/features/admin/haptics.ts"

export interface CopyLinkController {
  readonly copied: boolean
  readonly copy: () => Promise<void>
  /** Attach to the visible read-only control so a failed clipboard write can select it. */
  readonly fallbackRef: React.RefObject<HTMLInputElement | null>
}

/** Clipboard copy with haptic feedback, a 2s "Copied" flash, and select-fallback. */
export const useCopyLink = (link: string | undefined): CopyLinkController => {
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
    } catch {
      fallbackRef.current?.focus()
      fallbackRef.current?.select()
    }
  }

  return { copied, copy, fallbackRef }
}
