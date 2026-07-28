import { describe, expect, it } from "@effect/vitest"
import { busyByDate, instantOf } from "@/server/coach-day.ts"

/**
 * The conversion every scheduled session passes through, and the one place this
 * slice can be silently wrong by exactly one offset.
 *
 * A coach picks a wall-clock minute in their own zone; the column stores an
 * instant. Get that wrong and nothing fails loudly — sessions are simply booked
 * hours from where they were placed, and the grid's busy intervals come back for
 * the wrong day.
 */
describe("instantOf", () => {
  it("reads the minute as the coach's wall clock, not as UTC", () => {
    // Kyiv is UTC+3 in July: 10:00 there is 07:00Z. `DateTime.toDate` would
    // hand back 10:00Z — the reading rather than the instant.
    expect(instantOf("2026-07-27", 10 * 60, "Europe/Kyiv")?.toISOString()).toBe(
      "2026-07-27T07:00:00.000Z",
    )
  })

  it("follows the zone across its own daylight-saving change", () => {
    // Same wall clock, same zone, five months apart: UTC+2 in January.
    expect(instantOf("2027-01-11", 10 * 60, "Europe/Kyiv")?.toISOString()).toBe(
      "2027-01-11T08:00:00.000Z",
    )
  })

  it("brackets the coach's own day, which is not the UTC one", () => {
    expect(instantOf("2026-07-27", 0, "Europe/Kyiv")?.toISOString()).toBe(
      "2026-07-26T21:00:00.000Z",
    )
    expect(instantOf("2026-07-27", 24 * 60, "Europe/Kyiv")?.toISOString()).toBe(
      "2026-07-27T21:00:00.000Z",
    )
  })

  it("refuses a date it cannot read rather than inventing one", () => {
    expect(instantOf("not-a-date", 600, "Europe/Kyiv")).toBeUndefined()
  })
})

/**
 * The other half of the same offset problem, met when a fortnight is read in one
 * query (#186): each booking has to be filed under the day it falls on *where
 * the coach is*. File it under the UTC day and a slot reads as free on the
 * evening it is taken.
 */
const booking = (scheduledAt: string, durationMinutes = 60) => ({
  scheduledAt: new Date(scheduledAt),
  durationMinutes,
})

describe("busyByDate", () => {
  it("files a booking under the coach's day, as minutes of it", () => {
    const days = busyByDate([booking("2026-07-27T07:00:00.000Z")], "Europe/Kyiv")
    expect(days.get("2026-07-27")).toEqual([{ startMinutes: 600, endMinutes: 660 }])
  })

  it("moves a late-evening booking to the day the coach reads it on", () => {
    // 22:30Z is 01:30 the next morning in Kyiv — tomorrow's grid, not tonight's.
    const days = busyByDate([booking("2026-07-27T22:30:00.000Z", 30)], "Europe/Kyiv")
    expect(days.has("2026-07-27")).toBe(false)
    expect(days.get("2026-07-28")).toEqual([{ startMinutes: 90, endMinutes: 120 }])
  })

  it("keeps every booking of a day rather than the last one", () => {
    const days = busyByDate(
      [booking("2026-07-27T07:00:00.000Z", 30), booking("2026-07-27T09:00:00.000Z", 45)],
      "Europe/Kyiv",
    )
    expect(days.get("2026-07-27")).toEqual([
      { startMinutes: 600, endMinutes: 630 },
      { startMinutes: 720, endMinutes: 765 },
    ])
  })

  it("answers nothing for a day with nothing on it", () => {
    expect(busyByDate([], "Europe/Kyiv").get("2026-07-27")).toBeUndefined()
  })
})
