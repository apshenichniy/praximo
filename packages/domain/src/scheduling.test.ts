import { describe, expect, it } from "@effect/vitest"
import {
  BusinessDayEndMinutes,
  BusinessDayStartMinutes,
  daySlots,
  defaultDurationForKind,
  isSchedulableStart,
  nextSlotStart,
  partOfDay,
  PlannedDurations,
  SlotStepMinutes,
} from "./scheduling.ts"

const at = (hours: number, minutes = 0) => hours * 60 + minutes

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
  it("runs the business day in quarter-hour steps", () => {
    const slots = daySlots({ durationMinutes: 30, busy: [] })

    expect(slots[0]?.startMinutes).toBe(BusinessDayStartMinutes)
    expect(slots[1]?.startMinutes).toBe(BusinessDayStartMinutes + SlotStepMinutes)
    // The last start is `22:00 − duration`: a session that starts free must also
    // end inside the day.
    expect(slots.at(-1)?.startMinutes).toBe(BusinessDayEndMinutes - 30)
    expect(slots.every((slot) => slot.available)).toBe(true)
  })

  it("ends the day earlier for a longer session", () => {
    const half = daySlots({ durationMinutes: 30, busy: [] })
    const hour = daySlots({ durationMinutes: 60, busy: [] })

    expect(hour.at(-1)?.startMinutes).toBe(BusinessDayEndMinutes - 60)
    expect(hour.length).toBeLessThan(half.length)
  })

  // The decision the artifacts settled: a taken start is rendered and refused,
  // never removed, so the three-column grid does not reflow between days.
  it("keeps a busy start in the grid and marks it unavailable", () => {
    const slots = daySlots({
      durationMinutes: 30,
      busy: [{ startMinutes: at(11), endMinutes: at(12) }],
    })

    const busy = slots.filter((slot) => !slot.available).map((slot) => slot.startMinutes)
    expect(busy).toEqual([at(10, 45), at(11), at(11, 15), at(11, 30), at(11, 45)])
  })

  it("refuses a start whose session would run into a booked one", () => {
    const slots = daySlots({
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
      durationMinutes: 30,
      busy: [],
      earliestStartMinutes: at(15, 45),
    })

    expect(slots[0]?.startMinutes).toBe(at(15, 45))
    expect(slots.some((slot) => slot.startMinutes < at(15, 45))).toBe(false)
  })

  it("returns nothing when the day is too far gone for the chosen duration", () => {
    expect(daySlots({ durationMinutes: 60, busy: [], earliestStartMinutes: at(21, 15) })).toEqual([])
  })
})

describe("isSchedulableStart", () => {
  it("accepts a start on the grid that fits inside the day", () => {
    expect(isSchedulableStart(at(10), 30)).toBe(true)
    expect(isSchedulableStart(BusinessDayEndMinutes - 45, 45)).toBe(true)
  })

  it("refuses a start off the quarter-hour grid", () => {
    expect(isSchedulableStart(at(10, 7), 30)).toBe(false)
  })

  it("refuses a start outside business hours or one that overruns the day", () => {
    expect(isSchedulableStart(at(7, 45), 30)).toBe(false)
    expect(isSchedulableStart(BusinessDayEndMinutes - 30, 60)).toBe(false)
  })

  it("refuses a duration the product does not plan", () => {
    expect(isSchedulableStart(at(10), 90)).toBe(false)
  })
})
