import { ComputerIcon, Moon02Icon, Sun03Icon } from "@hugeicons-pro/core-stroke-rounded"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@praximo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@praximo/ui/components/dropdown-menu"
import { useEffect, useState } from "react"

import type { ChromeCopy } from "@/features/i18n/chrome-copy.ts"
import { useSystemThemeWhileUnset } from "@/lib/use-system-theme.ts"
import {
  applyColorScheme,
  readThemePreference,
  resolveColorScheme,
  type ThemePreference,
  writeThemePreference,
} from "@/lib/theme.ts"

/**
 * System / light / dark — one control, on every page of this app.
 *
 * It used to be two. The legal footer carried three text chips and the
 * acceptance page a named dropdown, so a client who accepted an invitation and
 * then opened the privacy policy from it met the same setting wearing two
 * different faces, in two different places, one screen apart.
 *
 * **The trigger is an icon and the options are words.** A row of three icons
 * would make the reader decode a sun, a moon and a monitor before they can
 * change anything, and «Системный» is not a picture anybody guesses. An icon is
 * the right trigger because it does not have to be *read* — it says only "this
 * is the appearance control", and the menu behind it says the rest. It also
 * stops the frame competing with the page: on a legal text, and on a page whose
 * one loud thing should be the commit button, a chrome control that spells out
 * «Системный» is the widest thing in the footer.
 *
 * The icon shows the preference rather than the resolved scheme — a reader on
 * `system` sees the monitor, not whichever of sun or moon happens to be on.
 * Showing the resolved one would make the control claim a choice nobody made.
 */

const ORDER = ["system", "light", "dark"] as const

const icons = {
  system: ComputerIcon,
  light: Sun03Icon,
  dark: Moon02Icon,
} as const

/**
 * Rendered only after mount, and `null` before it: the preference lives in
 * `localStorage`, so the server cannot know which of the three is on, and a
 * server-rendered trigger would show the wrong icon for a frame and then correct
 * itself in front of the reader. The *scheme* does not wait for this — the
 * blocking script in `<head>` has already settled it. Only the indicator does,
 * which is the one thing that can afford to.
 */
export function AppearanceMenu({ copy }: { readonly copy: ChromeCopy }) {
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            // The whole accessible name, because there is no text beside it.
            // «Внешний вид» alone would not say which of the three is on, so the
            // current answer travels with it.
            aria-label={`${copy.theme.label}: ${copy.theme[preference]}`}
          >
            <HugeiconsIcon icon={icons[preference]} size={17} strokeWidth={1.8} />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {/*
          A radio group, not plain items: three mutually exclusive answers, one
          of which is always on, and the one that is on has to *look* on. Plain
          items would make this a menu of three commands with no state — the
          reader would open it to find out which appearance they had chosen and
          learn nothing.
        */}
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(next) => choose(next as ThemePreference)}
        >
          {ORDER.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              <HugeiconsIcon icon={icons[option]} size={16} strokeWidth={1.8} />
              {copy.theme[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
