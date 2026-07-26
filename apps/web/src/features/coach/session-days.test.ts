import { describe, expect, it } from "vitest"

import { groupByDay, sessionClock } from "@/features/coach/session-days.ts"

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

  it("has nothing to say about an empty list", () => {
    expect(groupByDay([], { timezone: "Europe/Kyiv", language: "en", now: NOW, words })).toEqual([])
  })
})

describe("sessionClock", () => {
  it("writes a start on the coach's own 24-hour clock", () => {
    expect(sessionClock("en", "Europe/Kyiv").format(new Date("2026-07-27T11:30:00.000Z"))).toBe(
      "14:30",
    )
  })
})
