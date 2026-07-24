import { afterEach, describe, expect, it, vi } from "vitest"
import { formatExpiresIn } from "./formatting.ts"

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
