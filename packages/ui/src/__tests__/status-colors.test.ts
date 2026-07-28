import { describe, expect, it } from "vitest"

import { contrastRatio, hexToOklch, normalizeOklch, oklchToHex } from "../lab/status-colors.ts"

describe("UI Lab status colors", () => {
  it("normalizes decimal and percentage OKLCH input", () => {
    expect(normalizeOklch("oklch(0.637 0.237 25.331)")).toBe("oklch(0.637 0.237 25.331)")
    expect(normalizeOklch("oklch(63.7% 0.237 25.331deg)")).toBe("oklch(0.637 0.237 25.331)")
    expect(normalizeOklch("oklch(98.5% 0 none)")).toBe("oklch(0.985 0 0)")
    expect(normalizeOklch("rgb(255 0 0)")).toBeNull()
    expect(normalizeOklch("oklch(120% 0.2 20)")).toBeNull()
  })

  it("round-trips the native color picker through OKLCH", () => {
    const value = hexToOklch("#16803b")

    expect(value).toMatch(/^oklch\(/)
    expect(oklchToHex(value ?? "")).toBe("#16803b")
    expect(hexToOklch("#fff")).toBe("oklch(1 0 0)")
  })

  it("calculates contrast from OKLCH colors", () => {
    expect(contrastRatio("oklch(1 0 0)", "oklch(0 0 0)")).toBeCloseTo(21, 5)
    expect(
      contrastRatio("oklch(1 0 0)", "oklch(0.527142 0.138742 149.393)"),
    ).toBeGreaterThanOrEqual(4.5)
  })
})
