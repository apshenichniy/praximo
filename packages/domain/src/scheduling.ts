import { Schema } from "effect"
import { type DayWindow, MinutesInDay, SlotStepMinutes } from "./day-window.ts"

/**
 * The rules the scheduling sheet is built from (#56 §Scheduling), as data.
 *
 * They live in the domain rather than in the Mini App because both sides need
 * the same answer and neither may be the authority alone: the browser draws the
 * grid, the server refuses a start that is not on it, and a second copy of
 * "which starts exist" is how the two drift into offering what the other will
 * not take.
 */

export { MinutesInDay, SlotStepMinutes } from "./day-window.ts"

/**
 * The lengths a coach can plan. 90 minutes was considered and dropped: running
 * over is already a *room* behaviour — grace plus extensions inside `ROOM_CAP`
 * (web-room-sessions.md §1) — while a booked 90 spends the calendar in advance,
 * and a duration in the database can never be removed again.
 */
export const PlannedDurations = [30, 45, 60] as const
export type PlannedDuration = (typeof PlannedDurations)[number]
export const PlannedDuration = Schema.Literals(PlannedDurations)

export const SessionKinds = ["intake", "regular"] as const
export const SessionKind = Schema.Literals(SessionKinds)
export type SessionKind = typeof SessionKind.Type

/**
 * Intake is short, a regular session is the hour. The default *follows* the kind
 * and stops following the moment the coach touches the chips — that second half
 * belongs to the screen, since only it knows whether a human has been here.
 */
export const defaultDurationForKind = (kind: SessionKind): PlannedDuration =>
  kind === "intake" ? 30 : 60

/**
 * How far a reveal reaches past a coach's own hours (#210).
 *
 * Not the whole day, though the server would now take it: 96 starts is a list
 * nobody reads, and the small hours are not what "I need Saturday early" means.
 * The screen still offers strictly less than the server accepts, which is the
 * direction this drift is allowed to run in.
 */
export const RevealFromMinutes = 6 * 60
export const RevealUntilMinutes = 23 * 60

export const PartsOfDay = ["morning", "afternoon", "evening"] as const
export type PartOfDay = (typeof PartsOfDay)[number]

const AfternoonFromMinutes = 12 * 60
const EveningFromMinutes = 17 * 60

/** Which group a start belongs to — the sticky headings and their counts. */
export const partOfDay = (startMinutes: number): PartOfDay => {
  if (startMinutes < AfternoonFromMinutes) return "morning"
  return startMinutes < EveningFromMinutes ? "afternoon" : "evening"
}

/** Minutes-of-day the coach is already occupied for, as half-open intervals. */
export interface BusyInterval {
  readonly startMinutes: number
  readonly endMinutes: number
}

export interface DaySlot {
  readonly startMinutes: number
  /** False when the session would run into something already booked. */
  readonly available: boolean
}

export interface DaySlotsInput {
  /**
   * The stretch of day to fill. The coach's own hours for this weekday on the
   * sheet's first paint; the wider reveal window when they ask for all of them.
   */
  readonly window: DayWindow
  readonly durationMinutes: number
  readonly busy: ReadonlyArray<BusyInterval>
  /**
   * The first minute-of-day still worth offering — "now", rounded up, on today.
   * Absent on any other day, where the whole window is ahead.
   */
  readonly earliestStartMinutes?: number | undefined
}

/**
 * The next start on the grid strictly after `minutes`.
 *
 * Strictly, because a start the coach is standing on is a start that has passed
 * by the time the sheet renders it.
 */
export const nextSlotStart = (minutes: number): number =>
  (Math.floor(minutes / SlotStepMinutes) + 1) * SlotStepMinutes

const overlaps = (startMinutes: number, endMinutes: number, interval: BusyInterval): boolean =>
  startMinutes < interval.endMinutes && endMinutes > interval.startMinutes

/**
 * Every start inside one window, each marked free or taken.
 *
 * Two different rules, deliberately not one. A **taken** start is rendered and
 * refused — hiding it would reflow a three-column grid between days and cost the
 * positional memory that makes a long list scrollable at speed, and once an
 * external calendar feeds this, a silently vanished hour reads as a bug. A
 * **past** start has no row at all, because nobody asks why yesterday is
 * unavailable.
 */
export const daySlots = (input: DaySlotsInput): ReadonlyArray<DaySlot> => {
  const floor = Math.max(input.window.startMinutes, input.earliestStartMinutes ?? 0)
  // Aligned up rather than trusted: a window off the grid would otherwise
  // generate starts the server refuses, which is the drift running backwards.
  const first = Math.ceil(floor / SlotStepMinutes) * SlotStepMinutes
  const slots: Array<DaySlot> = []

  for (
    let start = first;
    start + input.durationMinutes <= input.window.endMinutes;
    start += SlotStepMinutes
  ) {
    const end = start + input.durationMinutes
    slots.push({
      startMinutes: start,
      available: !input.busy.some((interval) => overlaps(start, end, interval)),
    })
  }

  return slots
}

export interface DayGridInput {
  /** The coach's hours for this weekday, or nothing when they do not work it. */
  readonly working: DayWindow | undefined
  readonly durationMinutes: number
  readonly busy: ReadonlyArray<BusyInterval>
  readonly earliestStartMinutes?: number | undefined
}

/**
 * One day, split into what the sheet opens on and what it keeps behind a reveal.
 */
export interface DayGrid {
  /** Inside the coach's own hours — the grid as it paints. */
  readonly working: ReadonlyArray<DaySlot>
  /** Before those hours, and after them: what the two reveals hold. */
  readonly earlier: ReadonlyArray<DaySlot>
  readonly later: ReadonlyArray<DaySlot>
}

/** How far the reveals reach on a given day. */
export const revealWindow = (working: DayWindow | undefined): DayWindow => ({
  startMinutes: Math.min(RevealFromMinutes, working?.startMinutes ?? RevealFromMinutes),
  endMinutes: Math.max(RevealUntilMinutes, working?.endMinutes ?? RevealUntilMinutes),
})

/**
 * The day as the sheet needs it: the hours the coach works, and the hours they
 * do not, kept apart.
 *
 * Split here rather than on the screen so that "outside the hours" has one
 * definition. A start is outside because of where it **begins** relative to the
 * window, or because the session it begins would not end inside it — 18:45 is a
 * late start on a day that ends at 19:00 even though it starts inside it.
 *
 * A day switched off has no working starts and one reveal, carried in
 * `earlier`: both ends are the same end, and the screen words it as the day
 * being off rather than as an hour being early.
 */
export const dayGrid = (input: DayGridInput): DayGrid => {
  const revealed = daySlots({
    window: revealWindow(input.working),
    durationMinutes: input.durationMinutes,
    busy: input.busy,
    earliestStartMinutes: input.earliestStartMinutes,
  })

  if (input.working === undefined) {
    return { working: [], earlier: revealed, later: [] }
  }

  const working = input.working
  return {
    working: daySlots({
      window: working,
      durationMinutes: input.durationMinutes,
      busy: input.busy,
      earliestStartMinutes: input.earliestStartMinutes,
    }),
    earlier: revealed.filter((slot) => slot.startMinutes < working.startMinutes),
    later: revealed.filter(
      (slot) =>
        slot.startMinutes >= working.startMinutes &&
        slot.startMinutes + input.durationMinutes > working.endMinutes,
    ),
  }
}

/** How many of a day's slots are still free, per part of day — the headings' counts. */
export const freeSlotCounts = (slots: ReadonlyArray<DaySlot>): Record<PartOfDay, number> => {
  const counts: Record<PartOfDay, number> = { morning: 0, afternoon: 0, evening: 0 }
  for (const slot of slots) {
    if (slot.available) counts[partOfDay(slot.startMinutes)] += 1
  }
  return counts
}

/**
 * Is this start legal in the abstract — on the grid, long enough to end inside
 * the day it starts in?
 *
 * **It no longer asks about business hours**, and that is the point (#210).
 * Those bounds were a stand-in for an availability model the product did not
 * have; now that the coach states their own hours, keeping a second, hidden
 * ceiling would refuse exactly the booking the hours were made safe for — the
 * client flying out, the Saturday morning. Hours narrow the grid; this decides
 * what may be booked, and it stays wider than the grid on purpose.
 *
 * Still deliberately not the whole answer: overlap needs the day's sessions and
 * lives with the repository, and "is it in the past" needs an instant rather
 * than a minute-of-day.
 */
export const isSchedulableStart = (startMinutes: number, durationMinutes: number): boolean =>
  PlannedDurations.includes(durationMinutes as PlannedDuration) &&
  Number.isInteger(startMinutes) &&
  startMinutes % SlotStepMinutes === 0 &&
  startMinutes >= 0 &&
  startMinutes + durationMinutes <= MinutesInDay
