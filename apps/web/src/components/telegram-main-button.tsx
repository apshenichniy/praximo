import { useEffect, useRef, useState } from "react"

import {
  claimMainButton,
  loadTelegramWebApp,
  readTelegramInitData,
  type TelegramWebApp,
} from "@/lib/telegram.ts"

/**
 * A screen's primary action, handed to the host's own bottom button. It lives
 * outside the scroll area, so the action keeps one fixed place however much the
 * content above it grows — the reason it beats a row inside a list that other
 * sections can push down.
 *
 * `fallback` renders in place of it outside a Telegram host (local browser
 * development), so the action is never simply missing. It is passed in rather
 * than built here because each screen's in-page version belongs to that screen:
 * the coaches list wants a row inside its card, not a floating button.
 */
export function TelegramMainButton({
  text,
  onClick,
  fallback,
}: {
  readonly text: string
  readonly onClick: () => void
  readonly fallback: React.ReactNode
}) {
  const [usesNativeButton, setUsesNativeButton] = useState<boolean>()
  const [host, setHost] = useState<TelegramWebApp>()
  /**
   * The current handler and label, read through refs.
   *
   * The button is claimed **once per mount**. Claiming per render would mean a
   * `hide()` and a `show()` on every keystroke and every chip a screen offers —
   * the host animates both, so the button blinked at the bottom of the
   * scheduling screen each time the kind, the duration or the day changed, none
   * of which the button is about. `onClick` is a fresh closure whenever the
   * draft moves, so the host gets a stable wrapper and the closure is read at
   * press time.
   *
   * Across *routes* the same blink came from the mount itself, and that is
   * `claimMainButton`'s job rather than this component's — see `lib/telegram.ts`.
   */
  const handler = useRef(onClick)
  handler.current = onClick
  const label = useRef(text)
  label.current = text

  useEffect(() => {
    let cancelled = false
    let detach: (() => void) | undefined

    void loadTelegramWebApp().then((webApp) => {
      if (cancelled) return
      const isTelegramLaunch = Boolean(readTelegramInitData(webApp))
      setUsesNativeButton(isTelegramLaunch)
      if (webApp && isTelegramLaunch) {
        setHost(webApp)
        detach = claimMainButton(webApp, label.current, () => handler.current())
      }
    })

    return () => {
      cancelled = true
      detach?.()
    }
  }, [])

  /** A new label is a `setText`, not a re-attach: the button stays on screen. */
  useEffect(() => {
    host?.MainButton.setText(text)
  }, [host, text])

  // Undecided renders nothing: showing the fallback first and withdrawing it a
  // tick later would move every row under it just as the screen settles.
  if (usesNativeButton !== false) return null

  return fallback
}
