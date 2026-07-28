import {
  DefaultWorkingHours,
  type Weekday,
  type WorkingDay,
  type WorkingHours,
} from "@praximo/domain"
import { describe, expect, it } from "vitest"
import { summariseWorkingHours } from "@/features/coach/working-hours-summary.ts"

const at = (hours: number, minutes = 0) => hours * 60 + minutes

const week = (days: Partial<Record<Weekday, WorkingDay>>): WorkingHours => ({
  window: { startMinutes: at(9), endMinutes: at(19) },
  days: {
    mon: "window",
    tue: "window",
    wed: "window",
    thu: "window",
    fri: "window",
    sat: "window",
    sun: "window",
    ...days,
  },
})

describe("summariseWorkingHours", () => {
  it("says every day for the week nobody has narrowed", () => {
    const summary = summariseWorkingHours(DefaultWorkingHours)

    expect(summary.everyDay).toBe(true)
    expect(summary.window).toEqual({ startMinutes: at(8), endMinutes: at(22) })
    expect(summary.ownHours).toBe(0)
  })

  it("runs Monday to Friday together", () => {
    const summary = summariseWorkingHours(week({ sat: "off", sun: "off" }))

    expect(summary.run).toEqual(["mon", "tue", "wed", "thu", "fri"])
    expect(summary.contiguous).toBe(true)
    expect(summary.everyDay).toBe(false)
  })

  // The dash is only earned by consecutive days. «Mon–Fri» for a coach who
  // works Monday, Wednesday and Friday would be the line stating a week they
  // do not have.
  it("refuses a run for days that are not consecutive", () => {
    const summary = summariseWorkingHours(week({ tue: "off", thu: "off", sat: "off", sun: "off" }))

    expect(summary.run).toEqual(["mon", "wed", "fri"])
    expect(summary.contiguous).toBe(false)
  })

  it("refuses a run that wraps past Sunday", () => {
    const summary = summariseWorkingHours(
      week({ mon: "off", tue: "off", wed: "off", thu: "off", fri: "off" }),
    )

    expect(summary.run).toEqual(["sat", "sun"])
    expect(summary.contiguous).toBe(true)
  })

  it("counts the days that keep hours of their own", () => {
    const summary = summariseWorkingHours(
      week({ wed: { startMinutes: at(12), endMinutes: at(20) }, sun: "off" }),
    )

    expect(summary.ownHours).toBe(1)
    expect(summary.run).toContain("wed")
  })

  // A coach can switch every day off, and the line has to survive it: an empty
  // run with a window would otherwise read as hours nobody works.
  it("says when there are no working days at all", () => {
    const summary = summariseWorkingHours(
      week({
        mon: "off",
        tue: "off",
        wed: "off",
        thu: "off",
        fri: "off",
        sat: "off",
        sun: "off",
      }),
    )

    expect(summary.noDays).toBe(true)
    expect(summary.contiguous).toBe(false)
  })

  it("does not claim a run for a single working day", () => {
    const summary = summariseWorkingHours(
      week({ tue: "off", wed: "off", thu: "off", fri: "off", sat: "off", sun: "off" }),
    )

    expect(summary.run).toEqual(["mon"])
    expect(summary.contiguous).toBe(false)
  })
})
