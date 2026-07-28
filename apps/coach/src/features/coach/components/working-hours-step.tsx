import {
  type CoachLanguage,
  type DayWindow,
  type Weekday,
  windowForWeekday,
  type WorkingHours,
} from "@praximo/domain"
import { Heading } from "@praximo/ui"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { useState } from "react"

import {
  TimeWindowPicker,
  type WindowField,
} from "@/features/coach/components/time-window-picker.tsx"
import { WeekChips, WindowRow } from "@/features/coach/components/window-controls.tsx"
import type { AvailabilityCopy } from "@/features/i18n/coach-copy/availability.ts"
import { HostMainButton } from "@/presentation-host"

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
      <p className="text-muted-foreground mt-3 text-base leading-6">{copy.stepLede}</p>

      <div className="mt-8">
        <WindowRow
          window={hours.window}
          copy={copy}
          picking={picking}
          onPick={(field) => setPicking((was) => (was === field ? undefined : field))}
        />
      </div>

      {picking === undefined ? null : (
        <TimeWindowPicker window={hours.window} field={picking} copy={copy} onDone={setWindow} />
      )}

      <p className="text-muted-foreground mt-8 text-xs leading-normal font-semibold tracking-wide uppercase">
        {copy.daysLabel}
      </p>
      {/*
        The same chips the hours screen draws, bar and all: this step is that
        screen with its escape hatch removed, and two copies of one control are
        two controls that drift.
      */}
      <WeekChips
        language={language}
        windowFor={(weekday) => windowForWeekday(hours, weekday)}
        onToggle={toggleDay}
      />

      {error === undefined ? null : (
        <p className="text-destructive animate-in fade-in slide-in-from-bottom-1 mt-6 text-base leading-5 duration-150">
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
