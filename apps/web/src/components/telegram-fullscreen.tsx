import { useEffect } from "react"

import { enterFullscreen, loadTelegramWebApp } from "@/lib/telegram.ts"

/**
 * Drives the Mini App into fullscreen on mount (mini-app.md: "opens fullscreen …
 * `Telegram.WebApp.requestFullscreen()`, with `fullscreenChanged` handling and
 * safe-area insets in the layout"). Renders nothing — it is a lifecycle effect
 * wrapped as a component so any Mini App route tree can mount it once.
 *
 * The layout half of the requirement (padding by the host's safe-area insets)
 * lives in the frame that wraps this; here we only load the host script, call
 * `ready`/`expand`/`requestFullscreen`, and mirror the live fullscreen state onto
 * the document element so CSS can react. Everything runs client-only (the effect
 * never fires during SSR) and no-ops outside Telegram, where the version gate is
 * never met.
 */
export function TelegramFullscreen() {
  useEffect(() => {
    let cancelled = false
    let detach: (() => void) | undefined

    const start = async () => {
      const webApp = await loadTelegramWebApp()
      if (cancelled || !webApp) return
      detach = enterFullscreen(webApp, () => {
        document.documentElement.classList.toggle("tg-fullscreen", webApp.isFullscreen)
      })
    }

    void start()

    return () => {
      cancelled = true
      detach?.()
    }
  }, [])

  return null
}
