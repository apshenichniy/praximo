import { describe, expect, it } from "vitest"
import { localParts, nextDate, previousDate } from "@/lib/coach-calendar.ts"

/**
 * The half of the coach's calendar the browser reads. Effect-free by
 * construction (ADR 0002 §Effect conventions), and wrong by exactly one day
 * whenever it is wrong at all — which is why both halves are pinned here.
 */
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

describe("nextDate", () => {
  it("names the calendar day after this one", () => {
    expect(nextDate("2026-07-27")).toBe("2026-07-28")
    expect(nextDate("2026-07-31")).toBe("2026-08-01")
    expect(nextDate("2026-12-31")).toBe("2027-01-01")
  })

  /**
   * The night the clocks change, the coach's day is 23 or 25 hours long. A
   * «tomorrow» computed by adding 24 hours to an instant lands on the wrong
   * date; a calendar day has no such problem — the 25th is followed by the 26th
   * in every zone there is.
   */
  it("is unmoved by a day that is not 24 hours long", () => {
    expect(nextDate("2026-10-25")).toBe("2026-10-26")
    expect(nextDate("2027-02-28")).toBe("2027-03-01")
    expect(nextDate("2028-02-28")).toBe("2028-02-29")
  })

  it("hands back what it was given rather than inventing a date", () => {
    expect(nextDate("not-a-date")).toBe("not-a-date")
  })
})

/** The other direction, used to pre-read the day before the one on screen. */
describe("previousDate", () => {
  it("names the calendar day before this one", () => {
    expect(previousDate("2026-07-28")).toBe("2026-07-27")
    expect(previousDate("2026-08-01")).toBe("2026-07-31")
    expect(previousDate("2027-01-01")).toBe("2026-12-31")
    expect(previousDate("2028-03-01")).toBe("2028-02-29")
  })

  it("hands back what it was given rather than inventing a date", () => {
    expect(previousDate("not-a-date")).toBe("not-a-date")
  })
})
