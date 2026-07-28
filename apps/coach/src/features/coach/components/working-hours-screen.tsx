import {
  type CoachLanguage,
  type DayWindow,
  type Weekday,
  Weekdays,
  windowForWeekday,
  type WorkingHours,
} from "@praximo/domain"
import { cn } from "@praximo/ui"
import { useState } from "react"

import {
  TimeWindowPicker,
  type WindowField,
} from "@/features/coach/components/time-window-picker.tsx"
import { summariseWorkingHours } from "@/features/coach/working-hours-summary.ts"
import type { AvailabilityCopy } from "@/features/i18n/coach-copy/availability.ts"
import type { CommonCopy } from "@/features/i18n/coach-copy/common.ts"
import { weekdayLabel } from "@/features/i18n/weekday-label.ts"
import { HostBackButton, selectionHaptic } from "@/presentation-host"
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
const pad = (value: number): string => String(value).padStart(2, "0")
const clock = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

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
    selectionHaptic()
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
      <p className="text-muted-foreground mt-2 text-base leading-relaxed leading-6">
        {copy.hoursLede}
      </p>

      <p className="text-muted-foreground mt-8 text-xs leading-normal font-semibold tracking-wide uppercase">
        {copy.windowLabel}
      </p>

      <div className="mt-3 flex items-center gap-3">
        <WindowEnd
          label={copy.from}
          value={clock(hours.window.startMinutes)}
          open={picking === "start"}
          onOpen={() => setPicking((was) => (was === "start" ? undefined : "start"))}
        />
        <span aria-hidden className="text-muted-foreground text-base leading-relaxed">
          →
        </span>
        <WindowEnd
          label={copy.until}
          value={clock(hours.window.endMinutes)}
          open={picking === "end"}
          onOpen={() => setPicking((was) => (was === "end" ? undefined : "end"))}
        />
      </div>

      {picking === undefined ? null : (
        <TimeWindowPicker window={hours.window} field={picking} copy={copy} onDone={setWindow} />
      )}

      <p className="text-muted-foreground mt-8 text-xs leading-normal font-semibold tracking-wide uppercase">
        {copy.daysLabel}
      </p>

      {/*
        Seven across, not four and then three. The week is one row in the
        coach's head, and a second row of three wider chips reads as a second
        kind of day. At 375 points each chip is still over the 44-point target.
      */}
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {Weekdays.map((weekday) => (
          <DayChip
            key={weekday}
            label={weekdayLabel(language, weekday)}
            window={windowForWeekday(hours, weekday)}
            onToggle={() => toggleDay(weekday)}
          />
        ))}
      </div>

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
      <p className="border-border text-muted-foreground mt-8 border-t pt-3 text-xs leading-normal leading-5">
        {summary.noDays
          ? copy.noteNoDays
          : summary.ownHours > 0
            ? copy.noteOwnHours(summary.ownHours)
            : summary.everyDay
              ? copy.noteEveryDay(clock(hours.window.startMinutes), clock(hours.window.endMinutes))
              : copy.noteSomeOff}
      </p>

      {error === undefined ? null : (
        <p className="text-destructive animate-in fade-in slide-in-from-bottom-1 mt-3 text-base leading-relaxed leading-5 duration-150">
          {error}
        </p>
      )}
    </main>
  )
}

/**
 * One weekday, with the hours it works drawn under its name (#210).
 *
 * The bar is the whole reason the chips can stay a seventh of the screen wide.
 * A day that keeps its own hours has to be distinguishable from one that
 * follows the window — otherwise the window above is the only thing on screen
 * describing this day, and for this one it is wrong — and a segment sitting
 * somewhere else on the scale says that at a glance, where «12:00» would not
 * fit and a bare dot would say only «different, somehow».
 *
 * It is a readout, not a control: nothing here is draggable. A drag inside a
 * webview already means something to the host, and the interval is set by the
 * picker two fields up or on the per-day screen.
 */
const ScaleFromMinutes = 6 * 60
const ScaleToMinutes = 23 * 60

const positionOn = (minutes: number): number =>
  Math.min(
    100,
    Math.max(0, ((minutes - ScaleFromMinutes) / (ScaleToMinutes - ScaleFromMinutes)) * 100),
  )

function DayChip({
  label,
  window,
  onToggle,
}: {
  readonly label: string
  /** The hours this day works, or nothing when it is switched off. */
  readonly window: DayWindow | undefined
  readonly onToggle: () => void
}) {
  const off = window === undefined
  return (
    <button
      type="button"
      aria-pressed={!off}
      onClick={onToggle}
      className={cn(
        "flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-1.5",
        "ease-[var(--ease-out)] transition-[color,background-color,border-color,scale] duration-100 active:scale-[0.97]",
        off
          ? "border-border text-muted-foreground bg-transparent"
          : "border-border bg-secondary text-foreground",
      )}
    >
      <span className="text-xs leading-normal font-semibold">{label}</span>
      <span
        aria-hidden
        className={cn(
          "relative block h-1 w-full overflow-hidden rounded-full",
          !off && "bg-border",
        )}
      >
        {window === undefined ? null : (
          <span
            className="bg-muted-foreground ease-[var(--ease-out)] absolute inset-y-0 rounded-full transition-[left,right] duration-250"
            style={{
              left: `${positionOn(window.startMinutes)}%`,
              right: `${100 - positionOn(window.endMinutes)}%`,
            }}
          />
        )}
      </span>
    </button>
  )
}

function WindowEnd({
  label,
  value,
  open,
  onOpen,
}: {
  readonly label: string
  readonly value: string
  readonly open: boolean
  readonly onOpen: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onOpen}
      className={cn(
        "flex flex-1 flex-col items-start gap-0.5 rounded-2xl border px-4 py-3 text-left",
        "ease-[var(--ease-out)] transition-[color,background-color,border-color,scale] duration-100 active:scale-[0.98]",
        open ? "border-primary bg-secondary" : "border-border bg-secondary",
      )}
    >
      <span className="text-muted-foreground text-xs leading-normal">{label}</span>
      <span className="text-2xl leading-tight font-semibold tabular-nums">{value}</span>
    </button>
  )
}
