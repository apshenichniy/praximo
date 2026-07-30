import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const srcRoot = fileURLToPath(new URL("..", import.meta.url))
const component = (name: string): string =>
  readFileSync(join(srcRoot, "features/coach/components", name), "utf8")

describe("working-hours algebra wiring", () => {
  const weekEditors = [
    "working-hours-screen.tsx",
    "working-hours-step.tsx",
    "working-hours-days-screen.tsx",
  ] as const

  it.each(weekEditors)("%s delegates week mutations to the domain", (name) => {
    const source = component(name)

    expect(source).not.toContain("days: { ...")
    expect(source).not.toContain("Object.fromEntries(")
    expect(source).not.toMatch(/window\.startMinutes\s*===/)
  })

  it.each([
    ["working-hours-screen.tsx", ["toggleWeekday", "setSharedWindow"]],
    ["working-hours-step.tsx", ["toggleWeekday", "setSharedWindow"]],
    ["working-hours-days-screen.tsx", ["toggleWeekday", "setDayWindow", "applyWindowToAll"]],
  ] as const)("%s calls the domain operations", (name, operations) => {
    const source = component(name)

    for (const operation of operations) expect(source).toContain(operation)
  })

  it("keeps open-row state in the per-day UI while using the shared reader", () => {
    const source = component("working-hours-days-screen.tsx")

    expect(source).toContain("setOpen(")
    expect(source).toContain("windowForWeekday(hours, weekday)")
    expect(source).not.toContain("const hoursOf")
  })

  it("uses scheduling reveal bounds for the weekday chip scale", () => {
    const source = component("window-controls.tsx")

    expect(source).toContain("RevealFromMinutes")
    expect(source).toContain("RevealUntilMinutes")
    expect(source).not.toContain("ScaleFromMinutes")
    expect(source).not.toContain("ScaleToMinutes")
    expect(source).not.toContain("6 * 60")
    expect(source).not.toContain("23 * 60")
  })
})
