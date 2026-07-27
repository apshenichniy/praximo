import { useEffect } from "react"

import {
  applyColorScheme,
  preferredColorScheme,
  readThemePreference,
  watchPreferredColorScheme,
} from "@/lib/theme.ts"

/**
 * Keeps the page in the scheme the reader is in, for as long as it is open.
 *
 * The scheme of the *first* paint is settled before this mounts, by the blocking
 * script in `<head>` — see `THEME_BOOTSTRAP`. What is left for the client is
 * everything that can move afterwards: the `theme-color` meta, which does not
 * exist yet when the bootstrap runs (it is emitted by `HeadContent`, further
 * down the head), and a phone crossing into night with the page still on screen.
 *
 * The media query is watched only while the preference is `system`. A reader who
 * has chosen light does not want their choice overridden at sunset — that is the
 * difference between a default and a decision, and it is the reason the
 * preference stores three values rather than two.
 *
 * Mounted once, in the root shell, so it covers every route rather than the ones
 * that remembered it. Renders nothing.
 */
export function ClientTheme() {
  useEffect(() => {
    const preference = readThemePreference()
    applyColorScheme(preference === "system" ? preferredColorScheme() : preference)

    if (preference !== "system") return
    return watchPreferredColorScheme(applyColorScheme)
  }, [])

  return null
}
