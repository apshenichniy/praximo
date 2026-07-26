import { afterEach, describe, expect, it, vi } from "vitest"
import { formatDate, formatExpiresIn, formatRelativeTime, formatTimestamp } from "./formatting.ts"

const NOW = Date.parse("2026-07-24T12:00:00.000Z")
const inHours = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString()
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString()

const freezeClock = () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
}

afterEach(() => {
  vi.useRealTimers()
})

/**
 * The date formatters delegate to `@praximo/i18n` pinned at English (#167). The
 * suite only ever covered `formatExpiresIn`, which does not move — so it guarded
 * nothing about the delegation. These pin what the admin surface actually
 * promises: British order, a 24-hour clock, and its own word for "just now",
 * which the shared formatter deliberately refuses to supply.
 */
describe("the English date formatters", () => {
  const iso = "2026-07-26T14:30:00.000Z"

  it("writes the day first, the month by name, and the clock in 24 hours", () => {
    expect(formatDate(iso, "—")).toBe("26 Jul 2026")
    expect(formatTimestamp(iso, "—")).toMatch(/^26 Jul 2026\D+\d{2}:\d{2}$/)
  })

  it("answers with the empty label rather than a date for a missing value", () => {
    expect(formatTimestamp(undefined, "Never")).toBe("Never")
    expect(formatDate(undefined, "Not yet")).toBe("Not yet")
  })

  it("names the largest unit that fits, and says 'just now' under a minute", () => {
    freezeClock()

    expect(formatRelativeTime(hoursAgo(48))).toBe("2 days ago")
    expect(formatRelativeTime(hoursAgo(3))).toBe("3 hours ago")
    expect(formatRelativeTime(inHours(1))).toBe("in 1 hour")
    expect(formatRelativeTime(hoursAgo(0.001))).toBe("just now")
  })
})

describe("formatExpiresIn", () => {
  it("drops to hours inside the last day and never counts past zero", () => {
    freezeClock()

    expect(formatExpiresIn(inHours(6 * 24))).toBe("expires in 6d")
    expect(formatExpiresIn(inHours(25))).toBe("expires in 1d")
    expect(formatExpiresIn(inHours(23))).toBe("expires in 23h")
    expect(formatExpiresIn(inHours(0.5))).toBe("expires today")
    expect(formatExpiresIn(hoursAgo(1))).toBe("expired")
  })
})
