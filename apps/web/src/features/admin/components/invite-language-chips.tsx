import type { CoachLanguage } from "@praximo/domain"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx"
import { languageOptions } from "@/features/admin/formatting.ts"

const isCoachLanguage = (value: string | undefined): value is CoachLanguage =>
  languageOptions.some((option) => option.value === value)

/**
 * The invite-language chips, shared by every channel that carries a written
 * message (Copy, Email). This is the language of the *message*, chosen per
 * send — never a property of the coach, who picks their own during onboarding.
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
      <p className="text-sm font-medium">Invite language</p>
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
    </div>
  )
}
