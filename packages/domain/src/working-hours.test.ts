import { describe, expect, it } from "@effect/vitest"
import {
  DefaultWorkingHours,
  parseWorkingHours,
  readWorkingHours,
  Weekdays,
  windowForWeekday,
  type WorkingHours,
} from "./working-hours.ts"

const at = (hours: number, minutes = 0) => hours * 60 + minutes

describe("readWorkingHours", () => {
  // The blob predates the key and will outlive it, so nothing here is worth
  // failing a launch over: unreadable is read as "nothing has been chosen".
  it("reads a missing or malformed value as the default week", () => {
    expect(readWorkingHours(undefined)).toEqual(DefaultWorkingHours)
    expect(readWorkingHours(null)).toEqual(DefaultWorkingHours)
    expect(readWorkingHours("09:00")).toEqual(DefaultWorkingHours)
    expect(readWorkingHours([])).toEqual(DefaultWorkingHours)
  })

  it("defaults to 08:00–22:00 on all seven days", () => {
    expect(DefaultWorkingHours.window).toEqual({ startMinutes: at(8), endMinutes: at(22) })
    for (const weekday of Weekdays) {
      expect(DefaultWorkingHours.days[weekday]).toBe("window")
    }
  })

  it("reads a narrowed window and the days that follow it", () => {
    const hours = readWorkingHours({
      window: { startMinutes: at(9), endMinutes: at(19) },
      days: {
        mon: "window",
        tue: "window",
        wed: "window",
        thu: "window",
        fri: "window",
        sat: "off",
        sun: "off",
      },
    })

    expect(hours.window).toEqual({ startMinutes: at(9), endMinutes: at(19) })
    expect(hours.days.mon).toBe("window")
    expect(hours.days.sun).toBe("off")
  })

  it("reads a day that keeps its own hours", () => {
    const hours = readWorkingHours({
      window: { startMinutes: at(9), endMinutes: at(19) },
      days: { wed: { startMinutes: at(12), endMinutes: at(20) } },
    })

    expect(hours.days.wed).toEqual({ startMinutes: at(12), endMinutes: at(20) })
    // A day the blob does not mention follows the window, which is what a coach
    // who has never touched that day means.
    expect(hours.days.mon).toBe("window")
  })

  // Every rejection below falls back rather than throws: a broken window must
  // never be able to empty a coach's whole week.
  it("refuses a window that is not on the slot grid, or is inside out", () => {
    expect(readWorkingHours({ window: { startMinutes: at(9, 7), endMinutes: at(19) } })).toEqual(
      DefaultWorkingHours,
    )
    expect(readWorkingHours({ window: { startMinutes: at(19), endMinutes: at(9) } })).toEqual(
      DefaultWorkingHours,
    )
    expect(readWorkingHours({ window: { startMinutes: -60, endMinutes: at(19) } })).toEqual(
      DefaultWorkingHours,
    )
    expect(readWorkingHours({ window: { startMinutes: at(9), endMinutes: at(25) } })).toEqual(
      DefaultWorkingHours,
    )
  })

  it("drops one unreadable day rather than the whole week", () => {
    const hours = readWorkingHours({
      window: { startMinutes: at(9), endMinutes: at(19) },
      days: { mon: "off", tue: { startMinutes: at(20), endMinutes: at(10) }, wed: "sometimes" },
    })

    expect(hours.window).toEqual({ startMinutes: at(9), endMinutes: at(19) })
    expect(hours.days.mon).toBe("off")
    expect(hours.days.tue).toBe("window")
    expect(hours.days.wed).toBe("window")
  })
})

describe("parseWorkingHours", () => {
  const week = (days: Partial<Record<string, unknown>>) => ({
    window: { startMinutes: at(9), endMinutes: at(19) },
    days: {
      mon: "window",
      tue: "window",
      wed: "window",
      thu: "window",
      fri: "window",
      sat: "off",
      sun: "off",
      ...days,
    },
  })

  it("accepts a week a client could legitimately have built", () => {
    expect(parseWorkingHours(week({}))?.days.sat).toBe("off")
    expect(
      parseWorkingHours(week({ wed: { startMinutes: at(12), endMinutes: at(20) } }))?.days.wed,
    ).toEqual({ startMinutes: at(12), endMinutes: at(20) })
  })

  // The whole reason this is not `readWorkingHours`: falling back on a write
  // would turn "we could not understand you" into "you asked for the default",
  // and silently reset a week the coach spent taps on.
  it("refuses rather than falls back", () => {
    expect(parseWorkingHours(undefined)).toBeUndefined()
    expect(parseWorkingHours({})).toBeUndefined()
    expect(parseWorkingHours(week({ tue: "sometimes" }))).toBeUndefined()
    expect(
      parseWorkingHours(week({ fri: { startMinutes: at(19), endMinutes: at(9) } })),
    ).toBeUndefined()
    expect(
      parseWorkingHours({ window: { startMinutes: at(9, 7), endMinutes: at(19) }, days: {} }),
    ).toBeUndefined()
  })

  it("refuses a week that is missing a day", () => {
    const { sun: _dropped, ...rest } = week({}).days
    expect(parseWorkingHours({ window: week({}).window, days: rest })).toBeUndefined()
  })
})

describe("windowForWeekday", () => {
  const hours: WorkingHours = {
    window: { startMinutes: at(9), endMinutes: at(19) },
    days: {
      mon: "window",
      tue: "window",
      wed: { startMinutes: at(12), endMinutes: at(20) },
      thu: "window",
      fri: "window",
      sat: "window",
      sun: "off",
    },
  }

  it("gives the shared window to a day that follows it", () => {
    expect(windowForWeekday(hours, "mon")).toEqual({ startMinutes: at(9), endMinutes: at(19) })
  })

  it("gives a day its own hours when it has them", () => {
    expect(windowForWeekday(hours, "wed")).toEqual({ startMinutes: at(12), endMinutes: at(20) })
  })

  // Undefined rather than an empty interval: "not working" is a different
  // statement from "working for no minutes", and the sheet words them apart.
  it("gives nothing for a day that is not worked", () => {
    expect(windowForWeekday(hours, "sun")).toBeUndefined()
  })
})
