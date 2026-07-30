import {
  type BusyInterval,
  type CoachLanguage,
  dayGrid,
  type DaySlot,
  type DayWindow,
  freeSlotCounts,
  type PartOfDay,
  partOfDay,
  PartsOfDay,
} from "@praximo/domain"
import { sessionMoment } from "@praximo/i18n"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { clock } from "./clock.ts"

export interface DayScheduleData {
  readonly busy: ReadonlyArray<BusyInterval>
  readonly earliestStartMinutes?: number
  /**
   * The coach's own hours for this weekday (#210). Absent means the day is not
   * worked at all — a different statement from an empty grid.
   */
  readonly working?: DayWindow
  readonly timezone: string
}

export type SchedulingCopy = Pick<
  ClientsCopy,
  "morning" | "afternoon" | "evening" | "earlierHeading" | "laterHeading" | "dayOffHeading"
>

export interface DayGroupView {
  readonly part: PartOfDay
  readonly heading: string
  readonly freeCount: number
  readonly slots: ReadonlyArray<DaySlot>
}

export interface RevealGroupView {
  readonly heading: string
  readonly freeCount: number
  readonly slots: ReadonlyArray<DaySlot>
}

export interface DayView {
  readonly groups: ReadonlyArray<DayGroupView>
  readonly earlier: RevealGroupView | undefined
  readonly later: RevealGroupView | undefined
  readonly dayOff: boolean
  readonly anyFree: boolean
  readonly offsetLabel: string
}

const partLabel = (copy: SchedulingCopy, part: PartOfDay): string =>
  part === "morning" ? copy.morning : part === "afternoon" ? copy.afternoon : copy.evening

const freeCount = (slots: ReadonlyArray<DaySlot>): number =>
  slots.filter((slot) => slot.available).length

/**
 * The browser's own instant for a day and a minute of it. This is used only to
 * read the zone offset; the server owns conversion of a selected wall clock to
 * the stored session instant.
 */
const instantAt = (day: Date, minutes: number): Date => {
  const at = new Date(day)
  at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return at
}

/**
 * Everything the scheduling slot section needs for one duration on one day.
 *
 * Plain TypeScript by design: Coach React stays Effect-free (ADR 0002), while
 * the server remains authoritative for working hours and busy intervals.
 */
export const dayView = (input: {
  readonly schedule: DayScheduleData | undefined
  readonly durationMinutes: number
  readonly date: Date
  readonly startMinutes: number | undefined
  readonly language: CoachLanguage
  readonly copy: SchedulingCopy
}): DayView => {
  const grid =
    input.schedule === undefined
      ? { working: [], earlier: [], later: [] }
      : dayGrid({
          working: input.schedule.working,
          durationMinutes: input.durationMinutes,
          busy: input.schedule.busy,
          ...(input.schedule.earliestStartMinutes === undefined
            ? {}
            : { earliestStartMinutes: input.schedule.earliestStartMinutes }),
        })
  const counts = freeSlotCounts(grid.working)
  const groups = PartsOfDay.flatMap((part): ReadonlyArray<DayGroupView> => {
    const slots = grid.working.filter((slot) => partOfDay(slot.startMinutes) === part)
    return slots.length === 0
      ? []
      : [{ part, heading: partLabel(input.copy, part), freeCount: counts[part], slots }]
  })
  const dayOff = input.schedule !== undefined && input.schedule.working === undefined
  const earlier =
    dayOff || grid.earlier.length > 0
      ? {
          heading: dayOff
            ? input.copy.dayOffHeading
            : input.copy.earlierHeading(clock(grid.earlier[0]?.startMinutes ?? 0)),
          freeCount: freeCount(grid.earlier),
          slots: grid.earlier,
        }
      : undefined
  const later =
    !dayOff && grid.later.length > 0
      ? {
          heading: input.copy.laterHeading(
            clock((grid.later.at(-1)?.startMinutes ?? 0) + input.durationMinutes),
          ),
          freeCount: freeCount(grid.later),
          slots: grid.later,
        }
      : undefined
  const anyFree = [...grid.working, ...grid.earlier, ...grid.later].some((slot) => slot.available)
  const offsetLabel =
    input.schedule === undefined
      ? ""
      : sessionMoment(
          input.language,
          instantAt(input.date, input.startMinutes ?? 12 * 60),
          input.schedule.timezone,
        ).offset

  return { groups, earlier, later, dayOff, anyFree, offsetLabel }
}
