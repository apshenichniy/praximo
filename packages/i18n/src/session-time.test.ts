import { describe, expect, it } from "@effect/vitest"
import { sessionMoment } from "./session-time.ts"

const AUGUST = new Date("2026-08-03T07:00:00.000Z")
const JANUARY = new Date("2027-01-11T08:00:00.000Z")

describe("sessionMoment", () => {
  it("writes the day, the time and the offset in the coach's zone", () => {
    expect(sessionMoment("en", AUGUST, "Europe/Kyiv")).toEqual({
      day: "Monday 3 August",
      time: "10:00",
      offset: "UTC+3",
    })
  })

  // The whole reason the offset is computed on the session's own date: Kyiv is
  // UTC+3 in August and UTC+2 in January, and a session booked across the change
  // would otherwise be announced an hour wrong.
  it("computes the offset on the session's own date, not on today's", () => {
    expect(sessionMoment("en", JANUARY, "Europe/Kyiv")).toEqual({
      day: "Monday 11 January",
      time: "10:00",
      offset: "UTC+2",
    })
  })

  it("writes the day in the client's own language", () => {
    expect(sessionMoment("uk", AUGUST, "Europe/Kyiv").day).toBe("понеділок, 3 серпня")
    expect(sessionMoment("ru", AUGUST, "Europe/Kyiv").day).toBe("понедельник, 3 августа")
  })

  it("names UTC without a sign and keeps a half-hour zone's minutes", () => {
    expect(sessionMoment("en", AUGUST, "UTC").offset).toBe("UTC")
    expect(sessionMoment("en", AUGUST, "Asia/Kolkata").offset).toBe("UTC+5:30")
    expect(sessionMoment("en", AUGUST, "America/New_York").offset).toBe("UTC-4")
  })
})
