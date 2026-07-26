import { describe, expect, it } from "vitest"

import {
  addDays,
  sameDay,
  StripDays,
  stripAnchor,
  stripWindow,
} from "@/features/coach/day-strip.ts"

/**
 * The strip is the whole date field now, so a window that silently excludes the
 * chosen day would leave the screen claiming one date and highlighting none.
 */
const local = (value: string) => new Date(`${value}T09:00:00`)

describe("stripAnchor", () => {
  const TODAY = local("2026-07-27")

  it("starts at today while the chosen day is within reach", () => {
    expect(sameDay(stripAnchor(TODAY, TODAY), TODAY)).toBe(true)
    expect(sameDay(stripAnchor(TODAY, addDays(TODAY, StripDays - 1)), TODAY)).toBe(true)
  })

  it("follows a day chosen beyond the strip, keeping a neighbour before it", () => {
    const far = addDays(TODAY, StripDays)
    expect(sameDay(stripAnchor(TODAY, far), addDays(far, -1))).toBe(true)
  })

  it("never opens on a day already gone", () => {
    expect(sameDay(stripAnchor(TODAY, addDays(TODAY, -5)), TODAY)).toBe(true)
  })
})

describe("stripWindow", () => {
  const TODAY = local("2026-07-27")

  it("carries the chosen day, wherever it is", () => {
    for (const offset of [0, 1, StripDays - 1, StripDays, 60]) {
      const chosen = addDays(TODAY, offset)
      const days = stripWindow(TODAY, chosen)
      expect(days).toHaveLength(StripDays)
      expect(days.some((day) => sameDay(day, chosen))).toBe(true)
    }
  })

  it("runs consecutive days across a month boundary", () => {
    const days = stripWindow(local("2026-07-30"), local("2026-07-30"))
    expect(days[0]?.getDate()).toBe(30)
    expect(days[2]?.getMonth()).toBe(7)
    expect(days[2]?.getDate()).toBe(1)
  })
})
