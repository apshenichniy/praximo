import type { CoachLanguage } from "@praximo/domain"

import { Label } from "@praximo/ui/components/label"
import { ChoiceChip } from "@praximo/ui"
import { languageOptions } from "@/features/admin/formatting.ts"

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
      {/* The same chips the coach's own screens use (#58). This was a
          `ToggleGroup`, whose selected state is a pale `bg-muted` — the weakest
          way the app has of saying "this one", and the two surfaces asked the
          identical question in two different visual languages. */}
      <div role="group" aria-label="Invite language" className="mt-2 flex flex-wrap gap-2">
        {languageOptions.map((option) => (
          <ChoiceChip
            key={option.value}
            className="px-4"
            selected={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </ChoiceChip>
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-xs leading-normal leading-4">
        The invite and the whole bot setup are written in this language. Your coach can change it
        when they first sign in.
      </p>
    </div>
  )
}
