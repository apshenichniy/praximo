import { useEffect } from "react"

import {
  applyMainButtonColors,
  applyTelegramSurfaceColors,
  loadTelegramWebApp,
  readTelegramInitData,
  watchTelegramColorScheme,
} from "@/lib/telegram.ts"
import { applyColorScheme, watchPreferredColorScheme, type ColorScheme } from "@/lib/theme.ts"

/**
 * Keeps the app in the scheme its host is in, for as long as it is open (#190).
 *
 * The scheme of the *first* paint is settled before this mounts, by the blocking
 * script in `<head>` — see `COLOR_SCHEME_BOOTSTRAP`. What is left for the client
 * is everything that can move afterwards: a coach flipping the Telegram setting,
 * or a phone crossing into night with the Mini App still on screen.
 *
 * Three surfaces answer to a change, and only the first is CSS. The document
 * class carries the palette; the Telegram chrome (header, background, bottom
 * bar) and the host's bottom button are painted through the bridge, because the
 * page stylesheet does not reach them.
 *
 * Outside a Telegram launch — the acceptance page in a client's browser, local
 * development — the browser's own `prefers-color-scheme` is the host. The SDK
 * script is on every page, so a `WebApp` object existing proves nothing; a
 * signed `initData` is what separates a real launch from a plain visit, the same
 * test `TelegramMainButton` makes.
 *
 * Mounted once, in the root shell, so it covers every route rather than the ones
 * that remembered it. Renders nothing.
 */
export function TelegramTheme() {
  useEffect(() => {
    let cancelled = false
    let detach: (() => void) | undefined

    const start = async () => {
      const webApp = await loadTelegramWebApp()
      if (cancelled) return

      if (webApp === undefined || !readTelegramInitData(webApp)) {
        applyColorScheme(
          window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark",
        )
        detach = watchPreferredColorScheme(applyColorScheme)
        return
      }

      const follow = (scheme: ColorScheme) => {
        applyColorScheme(scheme)
        applyTelegramSurfaceColors(webApp, scheme)
        applyMainButtonColors(webApp, scheme)
      }

      follow(webApp.colorScheme)
      detach = watchTelegramColorScheme(webApp, follow)
    }

    void start()

    return () => {
      cancelled = true
      detach?.()
    }
  }, [])

  return null
}
