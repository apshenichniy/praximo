import type { CoachLanguage } from "@praximo/domain"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx"
import { languageOptions } from "@/features/admin/formatting.ts"

const isCoachLanguage = (value: string | undefined): value is CoachLanguage =>
  languageOptions.some((option) => option.value === value)

/**
 * The invite-language chips. One control on the "Invite a coach" screen, above
 * the three delivery actions, because from #164 this choice outlives the
 * message: it is what the coach's whole bot setup speaks, not only the sentence
 * carrying the link. Per-channel chips would have made the same coach's
 * language depend on which button the administrator happened to press.
 *
 * Still not the last word on it — the coach confirms or corrects it on their
 * first login, and that choice wins from then on.
 */
export function InviteLanguageChips({
  value,
  disabled,
  className,
  onChange,
}: {
  readonly value: CoachLanguage
  readonly disabled?: boolean
  readonly className?: string
  readonly onChange: (language: CoachLanguage) => void
}) {
  return (
    <div className={className}>
      <p className="text-body font-medium">Coach&rsquo;s language</p>
      <ToggleGroup
        aria-label="Invite language"
        className="mt-2"
        value={[value]}
        onValueChange={(next) => {
          const selected = next[0]
          // A chip tapped while already on reports an empty selection; the
          // language stays put rather than becoming undefined.
          if (isCoachLanguage(selected)) onChange(selected)
        }}
      >
        {languageOptions.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            disabled={disabled}
            className="rounded-full px-4"
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-muted-foreground mt-2 text-caption leading-4">
        The invite and the whole bot setup are written in this language. Your coach can change it
        when they first sign in.
      </p>
    </div>
  )
}
