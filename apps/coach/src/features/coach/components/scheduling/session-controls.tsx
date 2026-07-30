import { PlannedDurations, type SessionKind } from "@praximo/domain"
import { ChoiceChip } from "@praximo/ui"
import { Switch } from "@praximo/ui/components/switch"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { Field } from "./field.tsx"

export function SessionControls({
  copy,
  firstSession,
  kind,
  durationMinutes,
  onFirstSessionChange,
  onDurationChange,
}: {
  readonly copy: ClientsCopy
  readonly firstSession: boolean
  readonly kind: SessionKind
  readonly durationMinutes: number
  readonly onFirstSessionChange: (checked: boolean) => void
  readonly onDurationChange: (minutes: number) => void
}) {
  return (
    <>
      {/*
        The switch's own label is the label: another uppercase caption would put
        back the visual weight this control replaced.
      */}
      <div className="mt-5 flex items-center gap-4">
        <label htmlFor="first-session" className="flex min-h-11 flex-1 flex-col justify-center">
          <span className="text-base leading-relaxed font-semibold">{copy.firstSessionLabel}</span>
          {/*
            A stable fact about the client, so it never appears or disappears as
            the switch moves and never shifts the duration row under a thumb.
          */}
          {firstSession ? (
            <span className="text-muted-foreground mt-0.5 text-xs leading-normal">
              {copy.firstSessionHint}
            </span>
          ) : null}
        </label>
        <Switch
          id="first-session"
          checked={kind === "intake"}
          onCheckedChange={onFirstSessionChange}
        />
      </div>

      <Field label={copy.durationLabel}>
        <div className="flex gap-2">
          {PlannedDurations.map((minutes) => (
            <ChoiceChip
              key={minutes}
              className="flex-1 tabular-nums"
              selected={durationMinutes === minutes}
              onClick={() => onDurationChange(minutes)}
            >
              {minutes}
              {copy.durationSuffix}
            </ChoiceChip>
          ))}
        </div>
      </Field>
    </>
  )
}
