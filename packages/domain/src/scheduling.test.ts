import { describe, expect, it } from "@effect/vitest"
import { MinutesInDay } from "./day-window.ts"
import {
  dayGrid,
  daySlots,
  defaultDurationForKind,
  isSchedulableStart,
  nextSlotStart,
  partOfDay,
  PlannedDurations,
  RevealFromMinutes,
  RevealUntilMinutes,
  SlotStepMinutes,
} from "./scheduling.ts"
import { DefaultWorkingDayEndMinutes, DefaultWorkingDayStartMinutes } from "./working-hours.ts"

const at = (hours: number, minutes = 0) => hours * 60 + minutes

/** Today's default: the hours a coach who never opens the screen still has. */
const DefaultDay = {
  startMinutes: DefaultWorkingDayStartMinutes,
  endMinutes: DefaultWorkingDayEndMinutes,
}

describe("scheduling constants", () => {
  // The fourth chip was considered and dropped (#56 §No 90-minute chip): running
  // over is a room behaviour — grace plus extensions inside ROOM_CAP — not a
  // length a coach books in advance.
  it("offers exactly three planned durations", () => {
    expect(PlannedDurations).toEqual([30, 45, 60])
  })

  it("defaults the duration from the session kind", () => {
    expect(defaultDurationForKind("intake")).toBe(30)
    expect(defaultDurationForKind("regular")).toBe(60)
  })

  it("splits the day where a coach would say morning, afternoon and evening", () => {
    expect(partOfDay(at(8))).toBe("morning")
    expect(partOfDay(at(11, 45))).toBe("morning")
    expect(partOfDay(at(12))).toBe("afternoon")
    expect(partOfDay(at(16, 45))).toBe("afternoon")
    expect(partOfDay(at(17))).toBe("evening")
    expect(partOfDay(at(21, 45))).toBe("evening")
  })
})

describe("nextSlotStart", () => {
  it("rounds up to the next quarter-hour", () => {
    expect(nextSlotStart(at(15, 40))).toBe(at(15, 45))
    expect(nextSlotStart(at(15, 46))).toBe(at(16))
  })

  // A start exactly on the grid is still in the past by the time it is tapped,
  // so "now" never offers the minute it is standing on.
  it("moves off a start that is already here", () => {
    expect(nextSlotStart(at(15, 45))).toBe(at(16))
  })
})

describe("daySlots", () => {
  it("runs the window in quarter-hour steps", () => {
    const slots = daySlots({ window: DefaultDay, durationMinutes: 30, busy: [] })

    expect(slots[0]?.startMinutes).toBe(DefaultWorkingDayStartMinutes)
    expect(slots[1]?.startMinutes).toBe(DefaultWorkingDayStartMinutes + SlotStepMinutes)
    // The last start is `end − duration`: a session that starts free must also
    // end inside the window.
    expect(slots.at(-1)?.startMinutes).toBe(DefaultWorkingDayEndMinutes - 30)
    expect(slots.every((slot) => slot.available)).toBe(true)
  })

  it("ends the window earlier for a longer session", () => {
    const half = daySlots({ window: DefaultDay, durationMinutes: 30, busy: [] })
    const hour = daySlots({ window: DefaultDay, durationMinutes: 60, busy: [] })

    expect(hour.at(-1)?.startMinutes).toBe(DefaultWorkingDayEndMinutes - 60)
    expect(hour.length).toBeLessThan(half.length)
  })

  // The decision the artifacts settled: a taken start is rendered and refused,
  // never removed, so the three-column grid does not reflow between days.
  it("keeps a busy start in the grid and marks it unavailable", () => {
    const slots = daySlots({
      window: DefaultDay,
      durationMinutes: 30,
      busy: [{ startMinutes: at(11), endMinutes: at(12) }],
    })

    const busy = slots.filter((slot) => !slot.available).map((slot) => slot.startMinutes)
    expect(busy).toEqual([at(10, 45), at(11), at(11, 15), at(11, 30), at(11, 45)])
  })

  it("refuses a start whose session would run into a booked one", () => {
    const slots = daySlots({
      window: DefaultDay,
      durationMinutes: 60,
      busy: [{ startMinutes: at(11), endMinutes: at(12) }],
    })
    const available = new Set(
      slots.filter((slot) => slot.available).map((slot) => slot.startMinutes),
    )

    // 10:00 + 60 ends exactly when the booked session starts, which is free.
    expect(available.has(at(10))).toBe(true)
    expect(available.has(at(10, 15))).toBe(false)
    expect(available.has(at(12))).toBe(true)
  })

  // The other half of the rule: the past has no row at all, because nobody asks
  // why yesterday is unavailable.
  it("does not render a start that has already passed", () => {
    const slots = daySlots({
      window: DefaultDay,
      durationMinutes: 30,
      busy: [],
      earliestStartMinutes: at(15, 45),
    })

    expect(slots[0]?.startMinutes).toBe(at(15, 45))
    expect(slots.some((slot) => slot.startMinutes < at(15, 45))).toBe(false)
  })

  it("returns nothing when the day is too far gone for the chosen duration", () => {
    expect(
      daySlots({
        window: DefaultDay,
        durationMinutes: 60,
        busy: [],
        earliestStartMinutes: at(21, 15),
      }),
    ).toEqual([])
  })

  // A window read from an older blob, or written by a client that rounded
  // badly, must never generate a start the server would then refuse.
  it("aligns a window that is off the grid", () => {
    const slots = daySlots({
      window: { startMinutes: at(9, 7), endMinutes: at(11) },
      durationMinutes: 30,
      busy: [],
    })

    expect(slots[0]?.startMinutes).toBe(at(9, 15))
    expect(slots.every((slot) => slot.startMinutes % SlotStepMinutes === 0)).toBe(true)
  })
})

describe("dayGrid", () => {
  // A coach who never opens the settings screen sees exactly today's grid.
  it("gives the default day the same starts it has always had", () => {
    const grid = dayGrid({ working: DefaultDay, durationMinutes: 30, busy: [] })

    expect(grid.working[0]?.startMinutes).toBe(at(8))
    expect(grid.working.at(-1)?.startMinutes).toBe(at(21, 30))
    // 06:00–08:00 before it, and 22:00–23:00 after: the reveal reaches further
    // than the default day at both ends.
    expect(grid.earlier[0]?.startMinutes).toBe(RevealFromMinutes)
    expect(grid.earlier.at(-1)?.startMinutes).toBe(at(7, 45))
    expect(grid.later[0]?.startMinutes).toBe(at(21, 45))
    expect(grid.later.at(-1)?.startMinutes).toBe(RevealUntilMinutes - 30)
  })

  it("stops offering starts outside a narrowed day", () => {
    const grid = dayGrid({
      working: { startMinutes: at(9), endMinutes: at(19) },
      durationMinutes: 30,
      busy: [],
    })
    const starts = grid.working.map((slot) => slot.startMinutes)

    expect(starts).not.toContain(at(8))
    expect(starts[0]).toBe(at(9))
    expect(starts.at(-1)).toBe(at(18, 30))
    // 18:45 begins inside the window but would end outside it, so it is late
    // rather than working — one definition of "outside", not two.
    expect(grid.later[0]?.startMinutes).toBe(at(18, 45))
    expect(grid.earlier.at(-1)?.startMinutes).toBe(at(8, 45))
  })

  // Not an empty interval: the day is not worked at all, and the screen says so
  // rather than showing a grid with nothing in it.
  it("gives a day that is not worked one reveal and no working starts", () => {
    const grid = dayGrid({ working: undefined, durationMinutes: 30, busy: [] })

    expect(grid.working).toEqual([])
    expect(grid.later).toEqual([])
    expect(grid.earlier[0]?.startMinutes).toBe(RevealFromMinutes)
    expect(grid.earlier.at(-1)?.startMinutes).toBe(RevealUntilMinutes - 30)
  })

  // Narrowing the hours is not a statement about the past. The session stays
  // where it is; the grid simply stops offering the hour it sits in.
  it("keeps a session booked outside the new hours marked as busy", () => {
    const grid = dayGrid({
      working: { startMinutes: at(9), endMinutes: at(19) },
      durationMinutes: 30,
      busy: [{ startMinutes: at(20), endMinutes: at(21) }],
    })

    expect(grid.working.some((slot) => slot.startMinutes >= at(20))).toBe(false)
    const taken = grid.later.filter((slot) => !slot.available).map((slot) => slot.startMinutes)
    expect(taken).toEqual([at(19, 45), at(20), at(20, 15), at(20, 30), at(20, 45)])
  })

  it("carries the past cut into every group", () => {
    const grid = dayGrid({
      working: { startMinutes: at(9), endMinutes: at(19) },
      durationMinutes: 30,
      busy: [],
      earliestStartMinutes: at(10),
    })

    expect(grid.earlier).toEqual([])
    expect(grid.working[0]?.startMinutes).toBe(at(10))
  })
})

describe("isSchedulableStart", () => {
  it("accepts a start on the grid that fits inside the day", () => {
    expect(isSchedulableStart(at(10), 30)).toBe(true)
    expect(isSchedulableStart(MinutesInDay - 45, 45)).toBe(true)
  })

  it("refuses a start off the quarter-hour grid", () => {
    expect(isSchedulableStart(at(10, 7), 30)).toBe(false)
  })

  // The bound this ticket removed. Working hours narrow the grid; the server
  // stays wider, so the exception a coach needs is still bookable.
  it("accepts a start outside any plausible working hours", () => {
    expect(isSchedulableStart(at(7), 30)).toBe(true)
    expect(isSchedulableStart(at(23), 30)).toBe(true)
    expect(isSchedulableStart(at(5, 30), 60)).toBe(true)
  })

  it("refuses a session that would run past midnight, or start before the day", () => {
    expect(isSchedulableStart(MinutesInDay - 30, 60)).toBe(false)
    expect(isSchedulableStart(-15, 30)).toBe(false)
  })

  it("refuses a duration the product does not plan", () => {
    expect(isSchedulableStart(at(10), 90)).toBe(false)
  })
})
