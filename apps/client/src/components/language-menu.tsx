import { type CoachLanguage, CoachLanguages } from "@praximo/domain"
import { ClientLanguageNames } from "@praximo/i18n"
import { Button } from "@praximo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@praximo/ui/components/dropdown-menu"

/**
 * Which of the three languages the page is in.
 *
 * **The trigger keeps its words**, unlike the appearance control beside it, and
 * the asymmetry is the point rather than an oversight. A globe says "language"
 * and nothing else — a reader looking at one still has to open it to find out
 * which language they are in, and on a page whose whole content is prose, that
 * is the one thing the control should answer without being opened. «Українська»
 * is also its own best icon: it is legible to somebody who cannot read the
 * language currently on screen, which is exactly who reaches for this.
 *
 * A radio group for the same reason the appearance menu is one: three answers,
 * one always on, and the one that is on carries the indicator.
 */
export function LanguageMenu({
  locale,
  label,
  onChange,
}: {
  readonly locale: CoachLanguage
  readonly label: string
  readonly onChange: (language: CoachLanguage) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label={label}>
            {ClientLanguageNames[locale]}
            <Caret />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(next) => onChange(next as CoachLanguage)}
        >
          {CoachLanguages.map((language) => (
            <DropdownMenuRadioItem key={language} value={language}>
              {ClientLanguageNames[language]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Says "this opens a list" and nothing else — the label beside it is the name. */
function Caret() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="opacity-60">
      <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
