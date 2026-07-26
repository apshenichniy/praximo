import { describe, expect, it } from "@effect/vitest"
import { instantOf, localParts } from "./coach-clients.ts"

/**
 * The two conversions every scheduled session passes through, and the one place
 * this slice can be silently wrong by exactly one offset.
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

describe("localParts", () => {
  it("reports the day and minute an instant falls on in the coach's zone", () => {
    expect(localParts(new Date("2026-07-27T07:00:00.000Z"), "Europe/Kyiv")).toEqual({
      date: "2026-07-27",
      minutes: 10 * 60,
    })
  })

  // Late in the coach's evening it is already tomorrow in UTC, and "is the day
  // the sheet is looking at today?" must answer in the coach's calendar.
  it("keeps a late evening on the coach's own day", () => {
    expect(localParts(new Date("2026-07-27T20:30:00.000Z"), "Europe/Kyiv")).toEqual({
      date: "2026-07-27",
      minutes: 23 * 60 + 30,
    })
  })

  it("reads midnight as minute zero rather than as 24 hours", () => {
    expect(localParts(new Date("2026-07-26T21:00:00.000Z"), "Europe/Kyiv")).toEqual({
      date: "2026-07-27",
      minutes: 0,
    })
  })
})
