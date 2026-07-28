import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  feedbackEvents,
  interfaceTypographyRoles,
  prefersReducedMotion,
  typographyRecipe,
} from "../index.ts"

const packageRoot = fileURLToPath(new URL("../..", import.meta.url))
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8")
const componentSources = Object.fromEntries(
  ["badge", "button", "card", "field", "label", "switch"].map((component) => [
    component,
    readFileSync(new URL(`../components/ui/${component}.tsx`, import.meta.url), "utf8"),
  ]),
)
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  dependencies?: Record<string, string>
  exports?: Record<string, string>
}

describe("@praximo/ui public foundation", () => {
  it("exports every semantic interface typography role from one recipe owner", () => {
    expect(interfaceTypographyRoles).toEqual([
      "display",
      "page-title",
      "section-title",
      "card-title",
      "body",
      "body-small",
      "label",
      "caption",
    ])

    for (const role of interfaceTypographyRoles) {
      expect(typographyRecipe({ role })).toMatch(/\b(font|text|leading|tracking)-/)
    }
    expect(typographyRecipe({ role: "body", mono: true })).toContain("font-mono")
  })

  it("owns complete light and dark status families in static CSS", () => {
    expect(styles).toMatch(/:root\s*{/)
    expect(styles).toMatch(/\.dark\s*{/)

    for (const family of ["success", "warning", "error", "info"]) {
      for (const token of ["", "-foreground", "-surface", "-border"]) {
        expect(styles.match(new RegExp(`--${family}${token}:`, "g"))).toHaveLength(2)
      }
    }
  })

  it("publishes the clean Maia fonts without the retired private type scale", () => {
    expect(styles).toContain('@import "@fontsource-variable/inter"')
    expect(styles).toContain('@import "@fontsource-variable/geist-mono"')
    expect(styles).not.toMatch(/--text-(caption|body|emphasis|heading|title|display):/)
    expect(styles).not.toContain("--brand")
    expect(styles).not.toContain("--pressed")
  })

  it("removes transform and size motion for reduced-motion users", () => {
    expect(styles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
    expect(styles).toContain("animation-duration: 0.01ms")
    expect(styles).toContain("transition-duration: 0.01ms")
  })

  it("keeps the package independent from Telegram and application frameworks", () => {
    const dependencies = Object.keys(packageJson.dependencies ?? {})
    expect(dependencies.some((name) => name.includes("telegram"))).toBe(false)
    expect(dependencies.some((name) => name.includes("tanstack"))).toBe(false)
    expect(dependencies.some((name) => name.includes("router"))).toBe(false)
    expect(packageJson.exports?.["./styles.css"]).toBe("./src/styles.css")
    expect(packageRoot.replace(/\/$/, "").endsWith("/packages/ui")).toBe(true)
  })

  it("defines a host-neutral feedback vocabulary and a browser fallback", () => {
    expect(feedbackEvents).toEqual([
      "selection",
      "impact-light",
      "impact-medium",
      "success",
      "error",
    ])
    expect(prefersReducedMotion({ matches: true })).toBe(true)
    expect(prefersReducedMotion(undefined)).toBe(false)
  })

  it("keeps primitive motion specific and component typography centralized", () => {
    for (const source of Object.values(componentSources)) {
      expect(source).not.toContain("transition-all")
    }

    for (const component of ["badge", "button", "card", "field", "label"]) {
      expect(componentSources[component]).toContain("typographyRecipe")
    }
  })
})
