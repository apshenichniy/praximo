import { type DayWindow, isDayWindow } from "./day-window.ts"

/**
 * The hours a coach actually works, as seven weekday entries (#210).
 *
 * This is the *policy* half of "stop offering me slots I can't take", and it is
 * the half no calendar integration can ever supply: an empty Friday and a free
 * Friday are the same bytes in Google, while "I don't work Fridays" exists
 * nowhere but in the coach's head.
 *
 * **Hours narrow the grid, never the server.** `isSchedulableStart` keeps
 * deciding what may be booked; these decide only what the sheet offers first.
 * The drift is deliberately in the safe direction — the server accepts more
 * than the screen shows, never less — so a coach can always book the exception.
 */

export const Weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
export type Weekday = (typeof Weekdays)[number]

/**
 * What one weekday says: it follows the shared window, is not worked at all, or
 * carries hours of its own.
 *
 * `"window"` rather than a copy of the window's numbers, so that moving the
 * window moves every day that never disagreed with it. The alternative —
 * deriving "which days are the same" by comparing intervals — has no answer
 * when two days differ, and the screen has to state one.
 */
export type WorkingDay = "window" | "off" | DayWindow

export interface WorkingHours {
  /** The hours that apply to every day which has not been given its own. */
  readonly window: DayWindow
  readonly days: Readonly<Record<Weekday, WorkingDay>>
}

/**
 * Today's hard-coded business day, now a default rather than a rule. A coach
 * who never opens the screen sees exactly the grid they see today.
 */
export const DefaultWorkingDayStartMinutes = 8 * 60
export const DefaultWorkingDayEndMinutes = 22 * 60

export const DefaultWorkingHours: WorkingHours = {
  window: {
    startMinutes: DefaultWorkingDayStartMinutes,
    endMinutes: DefaultWorkingDayEndMinutes,
  },
  days: {
    mon: "window",
    tue: "window",
    wed: "window",
    thu: "window",
    fri: "window",
    sat: "window",
    sun: "window",
  },
}

const readDay = (value: unknown): WorkingDay => {
  if (value === "off") return "off"
  if (isDayWindow(value)) return value
  // Anything else — absent, misspelt, an interval that is inside out — means
  // the coach has never said otherwise about this day.
  return "window"
}

/**
 * Read the key tolerantly.
 *
 * Two different fallbacks, deliberately. A broken **window** takes the whole
 * value back to the default, because every day that follows it would otherwise
 * inherit nonsense. A broken **day** falls back on its own, because six good
 * days are not worth discarding over a seventh.
 */
export const readWorkingHours = (value: unknown): WorkingHours => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DefaultWorkingHours
  }
  const record = value as Record<string, unknown>
  if (!isDayWindow(record.window)) return DefaultWorkingHours

  const days = record.days
  const source = typeof days === "object" && days !== null ? (days as Record<string, unknown>) : {}

  return {
    window: { startMinutes: record.window.startMinutes, endMinutes: record.window.endMinutes },
    days: Object.fromEntries(
      Weekdays.map((weekday) => [weekday, readDay(source[weekday])]),
    ) as Record<Weekday, WorkingDay>,
  }
}

/**
 * The hours this weekday is worked, or nothing at all.
 *
 * `undefined` rather than a zero-length interval: "not working" is a different
 * statement from "working for no minutes", and the sheet words them apart —
 * one offers the day's hours, the other offers to show all of them anyway.
 */
export const windowForWeekday = (hours: WorkingHours, weekday: Weekday): DayWindow | undefined => {
  const day = hours.days[weekday]
  if (day === "off") return undefined
  return day === "window" ? hours.window : day
}

/**
 * Read a value a *client* sent, strictly.
 *
 * The mirror of `readWorkingHours` and deliberately not the same function.
 * Reading falls back, because a broken blob in the database must still launch
 * the app; writing refuses, because falling back on a write would let a
 * malformed request quietly reset a coach's whole week to the default — a
 * tolerant reader in front of a write turns "we could not understand you" into
 * "you asked for the default".
 */
export const parseWorkingHours = (value: unknown): WorkingHours | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!isDayWindow(record.window)) return undefined

  const days = record.days
  if (typeof days !== "object" || days === null) return undefined
  const source = days as Record<string, unknown>

  const parsed: Partial<Record<Weekday, WorkingDay>> = {}
  for (const weekday of Weekdays) {
    const day = source[weekday]
    if (day === "window" || day === "off") {
      parsed[weekday] = day
    } else if (isDayWindow(day)) {
      parsed[weekday] = { startMinutes: day.startMinutes, endMinutes: day.endMinutes }
    } else {
      return undefined
    }
  }

  return {
    window: { startMinutes: record.window.startMinutes, endMinutes: record.window.endMinutes },
    days: parsed as Record<Weekday, WorkingDay>,
  }
}

/** Which weekday a `Date.getDay()` index names — 0 is Sunday, as the platform has it. */
export const weekdayOfIndex = (index: number): Weekday => Weekdays[(index + 6) % 7] ?? "mon"

/** Whether every day of the week still follows the shared window. */
export const followsWindowEveryDay = (hours: WorkingHours): boolean =>
  Weekdays.every((weekday) => hours.days[weekday] === "window")

/** The days that carry hours of their own — what the summary line has to admit. */
export const daysWithOwnHours = (hours: WorkingHours): ReadonlyArray<Weekday> =>
  Weekdays.filter((weekday) => {
    const day = hours.days[weekday]
    return day !== "window" && day !== "off"
  })
