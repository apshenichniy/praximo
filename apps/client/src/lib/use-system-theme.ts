import { useEffect } from "react"

import { applyColorScheme, type ThemePreference, watchPreferredColorScheme } from "@/lib/theme.ts"

/**
 * Follow the browser's scheme for as long as the reader has not overruled it.
 *
 * Two components need this and need it for different moments — `ClientTheme` for
 * the page nobody touches, `AppearanceMenu` for the reader who switches *to* system
 * and expects it to start following at once rather than on the next load — so
 * the rule lives here rather than in a comment saying "keep these two in step".
 *
 * The condition is the point: a reader who chose light does not want their
 * choice overridden at sunset. That is the difference between a default and a
 * decision, and it is why the preference stores three values rather than two.
 */
export const useSystemThemeWhileUnset = (preference: ThemePreference | undefined): void => {
  useEffect(() => {
    if (preference !== "system") return
    return watchPreferredColorScheme(applyColorScheme)
  }, [preference])
}
