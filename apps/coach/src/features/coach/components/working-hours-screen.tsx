import {
  type CoachLanguage,
  type DayWindow,
  type Weekday,
  windowForWeekday,
  type WorkingHours,
} from "@praximo/domain"
import { useState } from "react"

import {
  TimeWindowPicker,
  type WindowField,
} from "@/features/coach/components/time-window-picker.tsx"
import { WeekChips, WindowRow } from "@/features/coach/components/window-controls.tsx"
import { summariseWorkingHours } from "@/features/coach/working-hours-summary.ts"
import type { AvailabilityCopy } from "@/features/i18n/coach-copy/availability.ts"
import type { CommonCopy } from "@/features/i18n/coach-copy/common.ts"
import { HostBackButton } from "@/mini-app.tsx"
import { Heading } from "@praximo/ui"

/**
 * Working hours (#210), as one shared window and seven days that follow it.
 *
 * The screen inverts the model without changing it. A coach almost always means
 * «nine to seven, not Sundays» — one interval and a couple of exceptions — so
 * the interval is the screen and the exceptions are a row of chips under it.
 * The seven entries the domain stores are still seven entries; this is the
 * cheapest way to say the common one.
 *
 * Per-day hours are a screen of their own rather than a fold here. A picker
 * opened inside a list of seven rows lands below the fold on a phone, which is
 * exactly the defect that argued against making the list the whole screen — and
 * a day that differs is the rarer errand, so it can afford the tap.
 *
 * **It commits on change**, with no Save. The host's back control is permanent
 * chrome at the top of the screen, and pairing it with a Save button makes «tap
 * back» a way to silently destroy an edit. Every change here is one labelled
 * tap, the line at the foot restates the result, the same tap undoes it — and
 * hours narrow the grid rather than the server, so a mis-tap can hide an option
 * but can never block a booking.
 */

export function WorkingHoursScreen({
  copy,
  common,
  language,
  hours,
  onChange,
  onPerDay,
  error,
}: {
  readonly copy: AvailabilityCopy
  readonly common: CommonCopy
  readonly language: CoachLanguage
  readonly hours: WorkingHours
  readonly onChange: (hours: WorkingHours) => void
  readonly onPerDay: () => void
  readonly error: string | undefined
}) {
  /** Which end of the window is being edited, if either. */
  const [picking, setPicking] = useState<WindowField>()
  const summary = summariseWorkingHours(hours)

  const toggleDay = (weekday: Weekday) => {
    const day = hours.days[weekday]
    onChange({
      ...hours,
      // Switching a day back on returns it to the shared window rather than to
      // the hours it used to keep: the coach turned it off, and a resurrected
      // exception nobody asked for is worse than one they set again.
      days: { ...hours.days, [weekday]: day === "off" ? "window" : "off" },
    })
  }

  const setWindow = (window: DayWindow) => {
    setPicking(undefined)
    // Every day that has not been given its own hours follows the window. That
    // propagation is the whole idea of the screen.
    onChange({ ...hours, window })
  }

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <HostBackButton label={common.back} />

      <Heading as="h1" role="page-title" className="mt-2">
        {copy.hoursTitle}
      </Heading>
      <p className="text-muted-foreground mt-2 text-base leading-6">{copy.hoursLede}</p>

      <p className="text-muted-foreground mt-8 text-xs leading-normal font-semibold tracking-wide uppercase">
        {copy.windowLabel}
      </p>

      <WindowRow
        window={hours.window}
        copy={copy}
        picking={picking}
        onPick={(field) => setPicking((was) => (was === field ? undefined : field))}
      />

      {picking === undefined ? null : (
        <TimeWindowPicker window={hours.window} field={picking} copy={copy} onDone={setWindow} />
      )}

      <p className="text-muted-foreground mt-8 text-xs leading-normal font-semibold tracking-wide uppercase">
        {copy.daysLabel}
      </p>

      <WeekChips
        language={language}
        windowFor={(weekday) => windowForWeekday(hours, weekday)}
        onToggle={toggleDay}
      />

      <button
        type="button"
        onClick={onPerDay}
        className="border-border active:bg-muted mt-6 flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors duration-100"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-base leading-relaxed font-medium">{copy.perDayRow}</span>
          <span className="text-muted-foreground mt-0.5 block text-xs leading-normal">
            {summary.ownHours > 0 ? copy.perDaySome(summary.ownHours) : copy.perDayNone}
          </span>
        </span>
        <span aria-hidden className="text-muted-foreground">
          ›
        </span>
      </button>

      {/* The result of the last tap, said back. */}
      <p className="border-border text-muted-foreground mt-8 border-t pt-3 text-xs leading-5">
        {summary.noDays
          ? copy.noteNoDays
          : summary.ownHours > 0
            ? copy.noteOwnHours(summary.ownHours)
            : summary.everyDay
              ? copy.noteEveryDay
              : copy.noteSomeOff}
      </p>

      {error === undefined ? null : (
        <p className="text-destructive animate-in fade-in slide-in-from-bottom-1 mt-3 text-base leading-5 duration-150">
          {error}
        </p>
      )}
    </main>
  )
}
