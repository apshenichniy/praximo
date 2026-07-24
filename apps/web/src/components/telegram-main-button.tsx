import { useEffect, useState } from "react"

import { attachMainButton, loadTelegramWebApp, readTelegramInitData } from "@/lib/telegram.ts"

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

  useEffect(() => {
    let cancelled = false
    let detach: (() => void) | undefined

    void loadTelegramWebApp().then((webApp) => {
      if (cancelled) return
      const isTelegramLaunch = Boolean(readTelegramInitData(webApp))
      setUsesNativeButton(isTelegramLaunch)
      if (webApp && isTelegramLaunch) {
        detach = attachMainButton(webApp, text, onClick)
      }
    })

    return () => {
      cancelled = true
      detach?.()
    }
  }, [text, onClick])

  // Undecided renders nothing: showing the fallback first and withdrawing it a
  // tick later would move every row under it just as the screen settles.
  if (usesNativeButton !== false) return null

  return fallback
}
