import {
  applyWindowToAll,
  type CoachLanguage,
  setDayWindow,
  toggleWeekday,
  type Weekday,
  Weekdays,
  windowForWeekday,
  type WorkingHours,
} from "@praximo/domain"
import { Switch } from "@praximo/ui/components/switch"
import { Heading, cn } from "@praximo/ui"
import { useState } from "react"

import { clock } from "@/features/coach/clock.ts"
import { TimeWindowPicker } from "@/features/coach/components/time-window-picker.tsx"
import type { AvailabilityCopy } from "@/features/i18n/coach-copy/availability.ts"
import type { CommonCopy } from "@/features/i18n/coach-copy/common.ts"
import { weekdayLabel } from "@/features/i18n/weekday-label.ts"
import { HostBackButton, selectionHaptic } from "@/mini-app.tsx"

/**
 * Hours per day (#210): the seven entries the domain stores, one row each.
 *
 * The escape hatch from the shared window, and a screen rather than a fold under
 * it. A picker opened inside seven rows wants more height than a phone has —
 * measured at 894 points against a body of 695 — which puts whatever follows it
 * off the bottom edge at the moment it appears. On a route of its own the list
 * has the whole screen, and the day that differs is the rarer errand anyway.
 *
 * It also grows: breaks, two shifts, a holiday are all rows on a list and none
 * of them are chips on a window.
 */

export function WorkingHoursDaysScreen({
  copy,
  common,
  language,
  hours,
  onChange,
  error,
}: {
  readonly copy: AvailabilityCopy
  readonly common: CommonCopy
  readonly language: CoachLanguage
  readonly hours: WorkingHours
  readonly onChange: (hours: WorkingHours) => void
  readonly error: string | undefined
}) {
  const [open, setOpen] = useState<Weekday>()

  const toggle = (weekday: Weekday) => {
    selectionHaptic()
    const day = hours.days[weekday]
    if (day !== "off" && open === weekday) setOpen(undefined)
    onChange(toggleWeekday(hours, weekday))
  }

  const firstWorking = Weekdays.find((weekday) => hours.days[weekday] !== "off")
  const anyOwnHours = Weekdays.some((weekday) => {
    const day = hours.days[weekday]
    return day !== "off" && day !== "window"
  })

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <HostBackButton label={common.back} />

      <Heading as="h1" role="page-title" className="mt-2">
        {copy.perDayTitle}
      </Heading>
      <p className="text-muted-foreground mt-2 text-base leading-6">{copy.perDayLede}</p>

      <div className="border-border mt-6 overflow-hidden rounded-2xl border">
        {Weekdays.map((weekday, index) => {
          const day = hours.days[weekday]
          const window = windowForWeekday(hours, weekday)
          return (
            <div key={weekday} className={cn(index > 0 && "border-border border-t")}>
              <div className="flex min-h-14 items-center gap-3 px-4 py-2">
                <span className="w-12 shrink-0 text-sm leading-normal font-semibold">
                  {weekdayLabel(language, weekday)}
                </span>
                <span className="min-w-0 flex-1">
                  {window === undefined ? (
                    <span className="text-muted-foreground text-base leading-relaxed">
                      {copy.notWorking}
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-expanded={open === weekday}
                      onClick={() => setOpen((was) => (was === weekday ? undefined : weekday))}
                      className={cn(
                        "rounded-lg px-2 py-1 text-base leading-relaxed font-semibold tabular-nums",
                        "ease-[var(--ease-out)] transition-colors duration-100",
                        open === weekday ? "bg-secondary" : "bg-transparent",
                      )}
                    >
                      {clock(window.startMinutes)} – {clock(window.endMinutes)}
                    </button>
                  )}
                </span>
                <Switch
                  checked={day !== "off"}
                  onCheckedChange={() => toggle(weekday)}
                  aria-label={weekdayLabel(language, weekday, "long")}
                />
              </div>
              {open === weekday && window !== undefined ? (
                <div className="px-4 pb-3">
                  <TimeWindowPicker
                    window={window}
                    // The row shows one interval rather than two ends, so the
                    // picker opens where reading it left off.
                    field="start"
                    copy={copy}
                    onDone={(next) => {
                      setOpen(undefined)
                      onChange(setDayWindow(hours, weekday, next))
                    }}
                  />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {anyOwnHours && firstWorking !== undefined ? (
        <button
          type="button"
          onClick={() => {
            const from = windowForWeekday(hours, firstWorking)
            if (from !== undefined) {
              selectionHaptic()
              setOpen(undefined)
              onChange(applyWindowToAll(hours, from))
            }
          }}
          className="border-border active:bg-muted mt-4 flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors duration-100"
        >
          <span className="min-w-0 flex-1 text-base leading-relaxed font-medium">
            {copy.applyToAll}
          </span>
          <span className="text-muted-foreground shrink-0 text-sm leading-normal tabular-nums">
            {(() => {
              const from = windowForWeekday(hours, firstWorking)
              return from === undefined
                ? ""
                : `${clock(from.startMinutes)}–${clock(from.endMinutes)}`
            })()}
          </span>
        </button>
      ) : null}

      {error === undefined ? null : (
        <p className="text-destructive animate-in fade-in slide-in-from-bottom-1 mt-3 text-base leading-5 duration-150">
          {error}
        </p>
      )}
    </main>
  )
}
