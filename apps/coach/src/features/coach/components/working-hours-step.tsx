import {
  type CoachLanguage,
  type DayWindow,
  type Weekday,
  Weekdays,
  type WorkingHours,
} from "@praximo/domain"
import { Heading, cn } from "@praximo/ui"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { useState } from "react"

import {
  TimeWindowPicker,
  type WindowField,
} from "@/features/coach/components/time-window-picker.tsx"
import type { AvailabilityCopy } from "@/features/i18n/coach-copy/availability.ts"
import { weekdayLabel } from "@/features/i18n/weekday-label.ts"
import { HostMainButton, selectionHaptic } from "@/presentation-host"

/**
 * First login, the optional third step (#210): the hours, offered once.
 *
 * **Optional and one tap from gone.** It is offered after the terms because
 * that is the one moment a coach is setting the practice up rather than using
 * it — but it can never stand between them and Today. Skipping is not a failure
 * state: nothing nags afterwards, and the same control lives in Availability
 * forever.
 *
 * The escape hatch does not ship on this copy of the screen. The whole decision
 * here is two controls already in view — a window and seven chips — so it can be
 * finished, or dismissed, without opening a second screen or accepting a week
 * somebody guessed on the coach's behalf.
 *
 * The host's bottom button comes back for exactly this screen, because here
 * Continue is a real action rather than a commit affordance over a screen that
 * commits on change.
 */
const pad = (value: number): string => String(value).padStart(2, "0")
const clock = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

export function WorkingHoursStep({
  copy,
  language,
  initial,
  onSave,
  onSkip,
  pending,
  error,
}: {
  readonly copy: AvailabilityCopy
  readonly language: CoachLanguage
  readonly initial: WorkingHours
  readonly onSave: (hours: WorkingHours) => void
  readonly onSkip: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const [hours, setHours] = useState(initial)
  /** Which end of the window is being edited, if either. */
  const [picking, setPicking] = useState<WindowField>()

  const toggleDay = (weekday: Weekday) => {
    selectionHaptic()
    setHours((was) => ({
      ...was,
      days: { ...was.days, [weekday]: was.days[weekday] === "off" ? "window" : "off" },
    }))
  }

  const setWindow = (window: DayWindow) => {
    setPicking(undefined)
    setHours((was) => ({ ...was, window }))
  }

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-28">
      <Heading as="h1" role="page-title">
        {copy.stepTitle}
      </Heading>
      <p className="text-muted-foreground mt-3 text-base leading-relaxed leading-6">
        {copy.stepLede}
      </p>

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          aria-expanded={picking === "start"}
          onClick={() => setPicking((was) => (was === "start" ? undefined : "start"))}
          className={cn(
            "flex flex-1 flex-col items-start gap-0.5 rounded-2xl border px-4 py-3 text-left",
            "ease-[var(--ease-out)] transition-[border-color,scale] duration-100 active:scale-[0.98]",
            picking === "start" ? "border-primary bg-secondary" : "border-border bg-secondary",
          )}
        >
          <span className="text-muted-foreground text-xs leading-normal">{copy.from}</span>
          <span className="text-2xl leading-tight font-semibold tabular-nums">
            {clock(hours.window.startMinutes)}
          </span>
        </button>
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
        <button
          type="button"
          aria-expanded={picking === "end"}
          onClick={() => setPicking((was) => (was === "end" ? undefined : "end"))}
          className={cn(
            "flex flex-1 flex-col items-start gap-0.5 rounded-2xl border px-4 py-3 text-left",
            "ease-[var(--ease-out)] transition-[border-color,scale] duration-100 active:scale-[0.98]",
            picking === "end" ? "border-primary bg-secondary" : "border-border bg-secondary",
          )}
        >
          <span className="text-muted-foreground text-xs leading-normal">{copy.until}</span>
          <span className="text-2xl leading-tight font-semibold tabular-nums">
            {clock(hours.window.endMinutes)}
          </span>
        </button>
      </div>

      {picking === undefined ? null : (
        <TimeWindowPicker window={hours.window} field={picking} copy={copy} onDone={setWindow} />
      )}

      <p className="text-muted-foreground mt-8 text-xs leading-normal font-semibold tracking-wide uppercase">
        {copy.daysLabel}
      </p>
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {Weekdays.map((weekday) => {
          const off = hours.days[weekday] === "off"
          return (
            <button
              key={weekday}
              type="button"
              aria-pressed={!off}
              onClick={() => toggleDay(weekday)}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-xl border px-1 text-xs leading-normal font-semibold",
                "ease-[var(--ease-out)] transition-[color,background-color,border-color,scale] duration-100 active:scale-[0.97]",
                off
                  ? "border-border text-muted-foreground bg-transparent"
                  : "border-border bg-secondary text-foreground",
              )}
            >
              {weekdayLabel(language, weekday)}
            </button>
          )
        })}
      </div>

      {error === undefined ? null : (
        <p className="text-destructive animate-in fade-in slide-in-from-bottom-1 mt-6 text-base leading-relaxed leading-5 duration-150">
          {error}
        </p>
      )}

      {/*
        Skip sits above the commit and reads as an ordinary control rather than
        a way out of something: nothing here is owed, and a coach who has just
        agreed to the terms should not meet a fourth thing that looks like it
        needs doing.
      */}
      <button
        type="button"
        onClick={onSkip}
        disabled={pending}
        className="text-muted-foreground mt-8 flex min-h-11 w-full items-center justify-center text-base leading-relaxed font-medium"
      >
        {copy.stepSkip}
      </button>

      <HostMainButton
        text={copy.stepContinue}
        onClick={() => onSave(hours)}
        fallback={
          <div className="mt-2">
            <Button
              className="h-12 w-full text-base leading-relaxed"
              disabled={pending}
              onClick={() => onSave(hours)}
            >
              {copy.stepContinue}
            </Button>
          </div>
        }
      />
    </main>
  )
}
