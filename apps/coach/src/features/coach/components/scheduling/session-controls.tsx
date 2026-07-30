import { PlannedDurations, type SessionKind } from "@praximo/domain"
import { ChoiceChip } from "@praximo/ui"
import { Switch } from "@praximo/ui/components/switch"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { Field } from "./field.tsx"

/**
 * The kind switch and the duration chips — and the switch is optional (#62).
 *
 * Absent rather than disabled when a session is being *moved*: the coach is not
 * being asked to leave it alone, they are not being asked at all. A disabled
 * control in the middle of a form is a question with no answer.
 */
export interface IntakeSwitch {
  /** Whether this client has no Sessions in Praximo yet — a fact, not a choice. */
  readonly firstSession: boolean
  readonly kind: SessionKind
  readonly onChange: (checked: boolean) => void
}

export function SessionControls({
  copy,
  intake,
  durationMinutes,
  onDurationChange,
}: {
  readonly copy: ClientsCopy
  /**
   * The switch, or nothing at all. One optional object rather than three
   * optional props: a `firstSession` with no handler is a control that renders
   * and does nothing, and the whole reason the caller passes a discriminated
   * purpose is that half-configured states should not typecheck.
   */
  readonly intake?: IntakeSwitch
  readonly durationMinutes: number
  readonly onDurationChange: (minutes: number) => void
}) {
  return (
    <>
      {/*
        The switch's own label is the label: another uppercase caption would put
        back the visual weight this control replaced.
      */}
      {intake === undefined ? null : (
        <div className="mt-5 flex items-center gap-4">
          <label htmlFor="first-session" className="flex min-h-11 flex-1 flex-col justify-center">
            <span className="text-base leading-relaxed font-semibold">
              {copy.firstSessionLabel}
            </span>
            {/*
              A stable fact about the client, so it never appears or disappears as
              the switch moves and never shifts the duration row under a thumb.
            */}
            {intake.firstSession ? (
              <span className="text-muted-foreground mt-0.5 text-xs leading-normal">
                {copy.firstSessionHint}
              </span>
            ) : null}
          </label>
          <Switch
            id="first-session"
            checked={intake.kind === "intake"}
            onCheckedChange={intake.onChange}
          />
        </div>
      )}

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
