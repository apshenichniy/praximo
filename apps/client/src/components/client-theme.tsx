import { useEffect, useState } from "react"

import { useSystemThemeWhileUnset } from "@/lib/use-system-theme.ts"
import {
  applyColorScheme,
  readThemePreference,
  resolveColorScheme,
  type ThemePreference,
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
 * Mounted once, in the root shell, so it covers every route rather than the ones
 * that remembered it. Renders nothing.
 */
export function ClientTheme() {
  const [preference, setPreference] = useState<ThemePreference>()

  useEffect(() => {
    const stored = readThemePreference()
    setPreference(stored)
    applyColorScheme(resolveColorScheme(stored))
  }, [])

  useSystemThemeWhileUnset(preference)

  return null
}
