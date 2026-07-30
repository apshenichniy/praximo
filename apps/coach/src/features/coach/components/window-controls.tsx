import {
  type CoachLanguage,
  type DayWindow,
  RevealFromMinutes,
  RevealUntilMinutes,
  type Weekday,
  Weekdays,
} from "@praximo/domain"
import { cn } from "@praximo/ui"

import { clock } from "@/features/coach/clock.ts"
import type { WindowField } from "@/features/coach/components/time-window-picker.tsx"
import type { AvailabilityCopy } from "@/features/i18n/coach-copy/availability.ts"
import { weekdayLabel } from "@/features/i18n/weekday-label.ts"
import { selectionHaptic } from "@/mini-app.tsx"

/**
 * The two controls the hours screen and the onboarding step share (#210): the
 * window's ends, and the week as chips.
 *
 * Shared rather than written twice because they are the same decision seen from
 * two places — the step is the hours screen with its escape hatch removed — and
 * two copies of a control are two controls that drift. They were already
 * drifting: the step's chips had lost the bar that says which day differs.
 */

/**
 * One end of the shared window. Both ends open the same picker, so which one was
 * pressed has to travel with the tap — otherwise «Until» edits the start.
 */
export function WindowEnd({
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

/** Both ends and the arrow between them. */
export function WindowRow({
  window,
  copy,
  picking,
  onPick,
}: {
  readonly window: DayWindow
  readonly copy: AvailabilityCopy
  readonly picking: WindowField | undefined
  readonly onPick: (field: WindowField) => void
}) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <WindowEnd
        label={copy.from}
        value={clock(window.startMinutes)}
        open={picking === "start"}
        onOpen={() => onPick("start")}
      />
      <span aria-hidden className="text-muted-foreground text-base leading-relaxed">
        →
      </span>
      <WindowEnd
        label={copy.until}
        value={clock(window.endMinutes)}
        open={picking === "end"}
        onOpen={() => onPick("end")}
      />
    </div>
  )
}

/**
 * One weekday, with the hours it works drawn under its name.
 *
 * The bar is what lets the chips stay a seventh of the screen wide. A day that
 * keeps its own hours has to be distinguishable from one that follows the
 * window — otherwise the window above is the only thing on screen describing
 * this day, and for this one it is wrong — and a segment sitting elsewhere on
 * the scale says that at a glance, where «12:00» would not fit.
 *
 * It is a readout, not a control: nothing here is draggable. A drag inside a
 * webview already means something to the host, and the interval is set by the
 * picker above or on the per-day screen.
 */
const positionOn = (minutes: number): number =>
  Math.min(
    100,
    Math.max(0, ((minutes - RevealFromMinutes) / (RevealUntilMinutes - RevealFromMinutes)) * 100),
  )

export function DayChip({
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
      onClick={() => {
        // The tick sits on the control that changes the selection rather than on
        // each screen that hosts it — two callers is two chances to forget it.
        selectionHaptic()
        onToggle()
      }}
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

/**
 * The week, seven across rather than four and then three. The week is one row in
 * the coach's head, and a second row of wider chips reads as a second kind of
 * day. At 375 points each chip still clears the 44-point target.
 */
export function WeekChips({
  language,
  windowFor,
  onToggle,
}: {
  readonly language: CoachLanguage
  readonly windowFor: (weekday: Weekday) => DayWindow | undefined
  readonly onToggle: (weekday: Weekday) => void
}) {
  return (
    <div className="mt-3 grid grid-cols-7 gap-1.5">
      {Weekdays.map((weekday) => (
        <DayChip
          key={weekday}
          label={weekdayLabel(language, weekday)}
          window={windowFor(weekday)}
          onToggle={() => onToggle(weekday)}
        />
      ))}
    </div>
  )
}
