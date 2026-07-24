import { FieldError } from "@/components/ui/field.tsx"
import { coachLanguages } from "@/features/admin/formatting.ts"
import { cn } from "@/lib/utils.ts"

/**
 * Segmented coach-language control. Keeps real radio semantics (sr-only
 * inputs inside labels) so keyboard and screen-reader behavior match a
 * native radio group.
 */
export function LanguagePicker({
  name,
  value,
  onChange,
  onBlur,
  error,
}: {
  readonly name: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onBlur: () => void
  readonly error: string | undefined
}) {
  return (
    <fieldset data-invalid={error === undefined ? undefined : true}>
      <legend className="mb-2 text-sm font-medium">Coach language</legend>
      <div className="bg-card ring-border grid grid-cols-3 gap-1 rounded-2xl p-1 ring-1">
        {coachLanguages.map(({ value: language, label }) => (
          <label
            key={language}
            className={cn(
              "cursor-pointer rounded-xl px-2 py-3 text-center text-sm transition-colors",
              value === language
                ? "bg-primary text-primary-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name={name}
              value={language}
              checked={value === language}
              aria-invalid={error === undefined ? undefined : true}
              onBlur={onBlur}
              onChange={() => onChange(language)}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>
      {error === undefined ? null : <FieldError className="mt-2">{error}</FieldError>}
    </fieldset>
  )
}
