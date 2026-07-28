import type { CoachLanguage } from "@praximo/domain"

import { Label } from "@praximo/ui/components/label"
import { ToggleGroup, ToggleGroupItem } from "@praximo/ui/components/toggle-group"
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
      {/* The primitive, not a hand-rolled `text-base leading-relaxed font-medium` (#201). This
          was the second one, and it is why raising the weight in `Label` fixed
          the field above it and left this one behind: a label that is not a
          `Label` does not move when labels do. The coach’s own new-client
          screen already uses it for the same name-plus-chips shape. */}
      <Label>Coach&rsquo;s language</Label>
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
      <p className="text-muted-foreground mt-2 text-xs leading-normal leading-4">
        The invite and the whole bot setup are written in this language. Your coach can change it
        when they first sign in.
      </p>
    </div>
  )
}
