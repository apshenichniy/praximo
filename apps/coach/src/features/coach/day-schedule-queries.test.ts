import { describe, expect, it } from "vitest"

import { dayChunks, StripRequestDays } from "@/features/coach/day-schedule-queries.ts"
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
