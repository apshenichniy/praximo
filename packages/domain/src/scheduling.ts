import { Schema } from "effect"

/**
 * The rules the scheduling sheet is built from (#56 §Scheduling), as data.
 *
 * They live in the domain rather than in the Mini App because both sides need
 * the same answer and neither may be the authority alone: the browser draws the
 * grid, the server refuses a start that is not on it, and a second copy of
 * "which starts exist" is how the two drift into offering what the other will
 * not take.
 */

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
 * Business hours, hard-coded, all seven days. There is no `working_hours`
 * column and no availability model in MVP, and inventing one would add a
 * settings screen this slice does not have. Saturday sessions happen; 03:00
 * sessions do not.
 */
export const BusinessDayStartMinutes = 8 * 60
export const BusinessDayEndMinutes = 22 * 60

/** The grid step. Coaches book on the hour and the half, but not only. */
export const SlotStepMinutes = 15

export const PartsOfDay = ["morning", "afternoon", "evening"] as const
export type PartOfDay = (typeof PartsOfDay)[number]

const AfternoonFromMinutes = 12 * 60
const EveningFromMinutes = 17 * 60

/** Which group a start belongs to — the sticky headers and the three anchors. */
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
  readonly durationMinutes: number
  readonly busy: ReadonlyArray<BusyInterval>
  /**
   * The first minute-of-day still worth offering — "now", rounded up, on today.
   * Absent on any other day, where the whole business day is ahead.
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
 * The whole grid for one day: every start that could still happen, each marked
 * free or taken.
 *
 * Two different rules, deliberately not one. A **taken** start is rendered and
 * refused — hiding it would reflow a three-column grid between days and cost the
 * positional memory that makes a long list scrollable at speed, and once an
 * external calendar feeds this, a silently vanished hour reads as a bug. A
 * **past** start has no row at all, because nobody asks why yesterday is
 * unavailable.
 */
export const daySlots = (input: DaySlotsInput): ReadonlyArray<DaySlot> => {
  const floor = input.earliestStartMinutes ?? BusinessDayStartMinutes
  const slots: Array<DaySlot> = []

  for (
    let start = BusinessDayStartMinutes;
    start + input.durationMinutes <= BusinessDayEndMinutes;
    start += SlotStepMinutes
  ) {
    if (start < floor) continue
    const end = start + input.durationMinutes
    slots.push({
      startMinutes: start,
      available: !input.busy.some((interval) => overlaps(start, end, interval)),
    })
  }

  return slots
}

/** How many of a day's slots are still free, per part of day — the anchors' counts. */
export const freeSlotCounts = (slots: ReadonlyArray<DaySlot>): Record<PartOfDay, number> => {
  const counts: Record<PartOfDay, number> = { morning: 0, afternoon: 0, evening: 0 }
  for (const slot of slots) {
    if (slot.available) counts[partOfDay(slot.startMinutes)] += 1
  }
  return counts
}

/**
 * Is this start legal in the abstract — on the grid, inside the day, and long
 * enough to end there?
 *
 * Deliberately not the whole answer: overlap needs the day's sessions and lives
 * with the repository, and "is it in the past" needs an instant rather than a
 * minute-of-day. This is the part that can be decided without either, and it is
 * what keeps a hand-made request off the grid the sheet draws.
 */
export const isSchedulableStart = (startMinutes: number, durationMinutes: number): boolean =>
  PlannedDurations.includes(durationMinutes as PlannedDuration) &&
  Number.isInteger(startMinutes) &&
  startMinutes % SlotStepMinutes === 0 &&
  startMinutes >= BusinessDayStartMinutes &&
  startMinutes + durationMinutes <= BusinessDayEndMinutes
