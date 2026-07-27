import { useEffect, useState } from "react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx"
import type { ChromeCopy } from "@/features/i18n/chrome-copy.ts"
import { useSystemThemeWhileUnset } from "@/lib/use-system-theme.ts"
import {
  applyColorScheme,
  readThemePreference,
  resolveColorScheme,
  type ThemePreference,
  writeThemePreference,
} from "@/lib/theme.ts"

const ORDER = ["system", "light", "dark"] as const

/**
 * System / light / dark, in the footer.
 *
 * Rendered only after mount, and returning `null` before it: the preference
 * lives in `localStorage`, so the server has no way to know which of the three
 * is on, and a server-rendered group would light the wrong chip for a fraction
 * of a second and then correct itself in front of the reader. The scheme itself
 * does not wait for this — the blocking script in `<head>` has already settled
 * it. Only the *indicator* does, which is the one thing that can afford to.
 *
 * `system` is the default and the first chip, because it is the answer most
 * readers want and the only one that keeps following them after they leave.
 */
export function ThemeSwitch({ copy }: { readonly copy: ChromeCopy }) {
  const [preference, setPreference] = useState<ThemePreference>()

  useEffect(() => {
    setPreference(readThemePreference())
  }, [])

  useSystemThemeWhileUnset(preference)

  if (preference === undefined) return null

  const choose = (next: ThemePreference) => {
    setPreference(next)
    writeThemePreference(next)
    applyColorScheme(resolveColorScheme(next))
  }

  return (
    <ToggleGroup
      aria-label={copy.theme.label}
      spacing={0}
      variant="outline"
      size="sm"
      value={[preference]}
      className="rounded-3xl"
    >
      {ORDER.map((option) => (
        <ToggleGroupItem
          key={option}
          value={option}
          pressed={preference === option}
          // Pressed *into* only. A group reports an empty selection when the
          // chip already on is tapped again, and "no appearance" is not one of
          // the three answers.
          onPressedChange={(pressed) => {
            if (pressed) choose(option)
          }}
          className="text-caption"
        >
          {copy.theme[option]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
