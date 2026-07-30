import { describe, expect, it } from "vitest"

import { firstSessionFor, groupByDay, sessionClock } from "@/features/coach/session-days.ts"

/**
 * The list is grouped by *the coach's* day, which is not the UTC one and not
 * always 24 hours long. Both of those are silent failures: the sessions all
 * render, under the wrong heading.
 */
const words = { today: "Today", tomorrow: "Tomorrow" } as const

const at = (value: string) => ({ scheduledAt: value })

describe("groupByDay", () => {
  const NOW = new Date("2026-07-27T09:00:00.000Z")

  it("gathers a day's sessions under one heading, in the order given", () => {
    const days = groupByDay([at("2026-07-27T10:00:00.000Z"), at("2026-07-27T14:00:00.000Z")], {
      timezone: "Europe/Kyiv",
      language: "en",
      now: NOW,
      words,
    })

    expect(days).toHaveLength(1)
    expect(days[0]?.date).toBe("2026-07-27")
    expect(days[0]?.heading).toBe("Today")
    expect(days[0]?.sessions).toHaveLength(2)
  })

  it("names today and tomorrow, and dates everything after them", () => {
    const days = groupByDay(
      [
        at("2026-07-27T10:00:00.000Z"),
        at("2026-07-28T10:00:00.000Z"),
        at("2026-07-30T10:00:00.000Z"),
      ],
      { timezone: "Europe/Kyiv", language: "en", now: NOW, words },
    )

    expect(days.map((day) => day.heading)).toEqual(["Today", "Tomorrow", "Thursday 30 July"])
  })

  /**
   * Late in the coach's evening it is already tomorrow in UTC. A session at
   * 23:30 Kyiv time belongs to the coach's today, and the dashboard that lists
   * it says so.
   */
  it("keeps a late evening session on the coach's own day", () => {
    const days = groupByDay([at("2026-07-27T20:30:00.000Z")], {
      timezone: "Europe/Kyiv",
      language: "en",
      now: new Date("2026-07-27T19:00:00.000Z"),
      words,
    })

    expect(days[0]?.date).toBe("2026-07-27")
    expect(days[0]?.heading).toBe("Today")
  })

  /**
   * The night the clocks go back, "now plus 24 hours" is still the same day. If
   * tomorrow were computed that way, the day after would be labelled «Tomorrow»
   * and the real tomorrow would get a weekday heading.
   */
  it("finds tomorrow through midnight rather than by adding a day", () => {
    // 25 October 2026: Kyiv leaves summer time, so that Sunday is 25 hours long.
    const days = groupByDay([at("2026-10-25T09:00:00.000Z")], {
      timezone: "Europe/Kyiv",
      language: "en",
      now: new Date("2026-10-24T09:00:00.000Z"),
      words,
    })

    expect(days[0]?.heading).toBe("Tomorrow")
  })

  it("writes the heading in the coach's language", () => {
    const days = groupByDay([at("2026-07-30T10:00:00.000Z")], {
      timezone: "Europe/Kyiv",
      language: "uk",
      now: NOW,
      words: { today: "Сьогодні", tomorrow: "Завтра" },
    })

    expect(days[0]?.heading).toContain("четвер")
  })

  /**
   * Past is the first list that can walk out of the current year (#232), and
   * «Monday 3 August» with no year is a date the coach cannot place. The year
   * appears only where it earns its keep — this year's headings are unchanged.
   */
  it("dates a day outside this year with its year, and leaves this year's alone", () => {
    const days = groupByDay([at("2026-07-30T10:00:00.000Z"), at("2025-08-04T10:00:00.000Z")], {
      timezone: "Europe/Kyiv",
      language: "en",
      now: NOW,
      words,
    })

    expect(days.map((day) => day.heading)).toEqual(["Thursday 30 July", "Monday 4 August 2025"])
  })

  /**
   * The year is the *coach's*, so a session at 01:30 Kyiv time on 1 January is
   * this year even though it is still 31 December in UTC.
   */
  it("decides the year in the coach's own zone", () => {
    const days = groupByDay([at("2026-12-31T23:30:00.000Z")], {
      timezone: "Europe/Kyiv",
      language: "en",
      now: new Date("2027-01-02T09:00:00.000Z"),
      words,
    })

    expect(days[0]?.date).toBe("2027-01-01")
    expect(days[0]?.heading).toBe("Friday 1 January")
  })

  /** A history reads newest first, and grouping has to survive that. */
  it("groups a descending list without repeating a day", () => {
    const days = groupByDay(
      [
        at("2026-07-27T14:00:00.000Z"),
        at("2026-07-27T10:00:00.000Z"),
        at("2026-07-24T10:00:00.000Z"),
      ],
      { timezone: "Europe/Kyiv", language: "en", now: NOW, words },
    )

    expect(days.map((day) => day.date)).toEqual(["2026-07-27", "2026-07-24"])
    expect(days[0]?.sessions).toHaveLength(2)
  })

  it("has nothing to say about an empty list", () => {
    expect(groupByDay([], { timezone: "Europe/Kyiv", language: "en", now: NOW, words })).toEqual([])
  })
})

/**
 * The intake switch reads a client's *whole* calendar (#232). Asking only what
 * is booked ahead is how a client seen weekly for a year, rebooking after a gap,
 * opened the scheduling screen labelled «Первая сессия».
 */
describe("firstSessionFor", () => {
  it("is a first session only when nothing is booked and nothing has happened", () => {
    expect(firstSessionFor({ sessions: [], past: [] })).toBe(true)
  })

  it("is not a first session for a returning client with nothing booked", () => {
    expect(firstSessionFor({ sessions: [], past: [{}] })).toBe(false)
  })

  it("is not a first session while one is already on the calendar", () => {
    expect(firstSessionFor({ sessions: [{}], past: [] })).toBe(false)
  })
})

describe("sessionClock", () => {
  it("writes a start on the coach's own 24-hour clock", () => {
    expect(sessionClock("en", "Europe/Kyiv").format(new Date("2026-07-27T11:30:00.000Z"))).toBe(
      "14:30",
    )
  })
})
