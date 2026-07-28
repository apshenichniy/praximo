import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"

import {
  dayChunks,
  dayScheduleKeys,
  primeDayRange,
  StripRequestDays,
} from "@/features/coach/day-schedule-queries.ts"
import type { CoachClients } from "@/server/coach-clients.ts"
import { StripHorizon } from "@/features/coach/day-strip.ts"

/**
 * How a window becomes requests. The chunks have to line up with how the strip
 * grows — a fortnight at a time — or every growth spurt would straddle two of
 * them and re-read days already in hand.
 */
describe("dayChunks", () => {
  it("asks for one fortnight when that is all the strip shows", () => {
    expect(dayChunks("2026-07-27", StripRequestDays)).toEqual([
      { from: "2026-07-27", days: StripRequestDays },
    ])
  })

  it("cuts a grown strip on fortnight boundaries, so a new one is one request", () => {
    const chunks = dayChunks("2026-07-27", StripRequestDays * 3)
    expect(chunks).toEqual([
      { from: "2026-07-27", days: 14 },
      { from: "2026-08-10", days: 14 },
      { from: "2026-08-24", days: 14 },
    ])
  })

  it("covers the whole horizon, with the remainder in the last chunk", () => {
    const chunks = dayChunks("2026-07-27", StripHorizon)
    expect(chunks.reduce((total, chunk) => total + chunk.days, 0)).toBe(StripHorizon)
    expect(chunks.at(-1)?.days).toBe(StripHorizon % StripRequestDays)
  })

  it("never asks for more days at once than the server answers", () => {
    for (const chunk of dayChunks("2026-07-27", StripHorizon)) expect(chunk.days).toBeLessThan(32)
  })
})

/**
 * What the strip files, and what a day is when it gets there.
 *
 * The primed day has to be indistinguishable from one the single-day query
 * returns. It was not: the range answer was copied field by field and
 * `working` was left behind (#210), so a day the strip had primed read as "not
 * a working day" while the same day fetched on its own read correctly — and
 * which of the two landed first was a race.
 */
const day = (date: string): CoachClients.DatedDaySchedule => ({
  date,
  busy: [{ startMinutes: 600, endMinutes: 660 }],
  earliestStartMinutes: 555,
  working: { startMinutes: 750, endMinutes: 1080 },
  timezone: "Europe/Madrid",
})

describe("primeDayRange", () => {
  it("files a whole day, working hours and all", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(dayScheduleKeys.range("2026-07-29", 1), [day("2026-07-29")])

    await primeDayRange(client, "2026-07-29", 1)

    expect(client.getQueryData(dayScheduleKeys.day("2026-07-29"))).toEqual({
      busy: [{ startMinutes: 600, endMinutes: 660 }],
      earliestStartMinutes: 555,
      working: { startMinutes: 750, endMinutes: 1080 },
      timezone: "Europe/Madrid",
    })
  })

  // A day the coach does not work carries no window at all, and the absence has
  // to survive the filing: it is what tells the sheet to say so.
  it("keeps a day that is not worked free of a window", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { working: _off, ...sunday } = day("2026-08-02")
    client.setQueryData(dayScheduleKeys.range("2026-08-02", 1), [sunday])

    await primeDayRange(client, "2026-08-02", 1)

    const filed = client.getQueryData<Record<string, unknown>>(dayScheduleKeys.day("2026-08-02"))
    expect(filed).toBeDefined()
    expect("working" in (filed ?? {})).toBe(false)
    // And the date it was filed under does not travel into the value.
    expect("date" in (filed ?? {})).toBe(false)
  })
})
