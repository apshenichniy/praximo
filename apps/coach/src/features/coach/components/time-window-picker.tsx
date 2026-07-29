import { type DayWindow, SlotStepMinutes } from "@praximo/domain"
import { ChoiceChip, cn } from "@praximo/ui"
import { useState } from "react"

import { selectionHaptic } from "@/presentation-host"

import { clock, pad } from "@/features/coach/clock.ts"
import type { AvailabilityCopy } from "@/features/i18n/coach-copy/availability.ts"

/**
 * The one control that sets an interval, shared by the shared window and by a
 * single day (#210).
 *
 * A grid of taps rather than a wheel. A webview cannot borrow the platform's own
 * picker, and a hand-built wheel is a drag with no detent a thumb can feel —
 * while hours and quarters are twenty-eight targets that each say what they are.
 *
 * **It commits when it closes, not when a key is pressed.** The value is
 * composed over two taps — an hour, then the minutes — so writing on every tap
 * would persist 09:00 on the way to 09:30 and put an intermediate week in the
 * database. `onDone` is the only thing that leaves this component.
 */
const Hours = Array.from({ length: 24 }, (_, hour) => hour)
const Minutes = [0, 15, 30, 45]

export type WindowField = "start" | "end"

export function TimeWindowPicker({
  window,
  field: opensOn,
  copy,
  onDone,
}: {
  readonly window: DayWindow
  /**
   * Which end the coach reached for. It has to travel in: opening on `start`
   * whichever button was pressed makes «Until 22:00» edit the *start*, which is
   * the picker quietly doing the opposite of what it was asked.
   */
  readonly field: WindowField
  readonly copy: AvailabilityCopy
  /** The interval as it stands when the picker closes — never before. */
  readonly onDone: (window: DayWindow) => void
}) {
  const [draft, setDraft] = useState<DayWindow>(window)
  const [field, setField] = useState<WindowField>(opensOn)

  const current = field === "start" ? draft.startMinutes : draft.endMinutes

  /**
   * Both ends stay a legal interval while one of them is being moved, which is
   * what lets the picker be dragged past itself without a rule that only fires
   * on close. `end` never falls to or below `start`, and `start` never reaches
   * `end` — one step apart is the smallest thing the grid can express.
   */
  // No haptic here: `ChoiceChip` emits `selection` itself, and only when the tap
  // actually moves the value — re-tapping the hour you are already on used to
  // buzz about a no-op.
  const set = (part: "hour" | "minute", value: number) => {
    setDraft((was) => {
      const at = field === "start" ? was.startMinutes : was.endMinutes
      const next = part === "hour" ? value * 60 + (at % 60) : Math.floor(at / 60) * 60 + value
      return field === "start"
        ? { ...was, startMinutes: Math.min(next, was.endMinutes - SlotStepMinutes) }
        : { ...was, endMinutes: Math.max(next, was.startMinutes + SlotStepMinutes) }
    })
  }

  return (
    <div className="border-border bg-card mt-2 rounded-2xl border p-4">
      <div className="flex gap-2">
        <FieldButton
          label={copy.pickerStart}
          value={clock(draft.startMinutes)}
          active={field === "start"}
          onSelect={() => setField("start")}
        />
        <FieldButton
          label={copy.pickerEnd}
          value={clock(draft.endMinutes)}
          active={field === "end"}
          onSelect={() => setField("end")}
        />
      </div>

      <div className="mt-4 grid grid-cols-6 gap-1.5">
        {Hours.map((hour) => (
          <Key
            key={hour}
            label={pad(hour)}
            selected={Math.floor(current / 60) === hour}
            onSelect={() => set("hour", hour)}
          />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5">
        {Minutes.map((minute) => (
          <Key
            key={minute}
            label={`:${pad(minute)}`}
            selected={current % 60 === minute}
            onSelect={() => set("minute", minute)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => onDone(draft)}
        className="bg-secondary border-border text-foreground ease-[var(--ease-out)] mt-4 flex min-h-11 w-full items-center justify-center rounded-xl border text-base leading-relaxed font-medium transition-transform duration-100 active:scale-[0.98]"
      >
        {copy.pickerDone}
      </button>
    </div>
  )
}

function FieldButton({
  label,
  value,
  active,
  onSelect,
}: {
  readonly label: string
  readonly value: string
  readonly active: boolean
  readonly onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      // Its own tick, which it never had. The file used to satisfy the
      // set-selection invariant by accident — `selectionHaptic` lived in the
      // key grid next door — and moving that into `ChoiceChip` (#58) is what
      // made the gap visible: switching which end you are editing is a
      // selection, and it was the one control here that said nothing.
      onClick={() => {
        if (!active) selectionHaptic()
        onSelect()
      }}
      className={cn(
        "flex flex-1 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left",
        "ease-[var(--ease-out)] transition-[color,background-color,border-color] duration-100",
        active ? "border-primary bg-secondary" : "border-border bg-secondary",
      )}
    >
      <span className="text-muted-foreground text-xs leading-normal">{label}</span>
      <span className="text-xl leading-tight font-semibold tabular-nums">{value}</span>
    </button>
  )
}

function Key({
  label,
  selected,
  onSelect,
}: {
  readonly label: string
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  return (
    // The same chip as the duration row, one size down: a slot grid puts many
    // per line, so the target tightens and the corner softens.
    <ChoiceChip size="sm" className="tabular-nums" selected={selected} onClick={onSelect}>
      {label}
    </ChoiceChip>
  )
}
