import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  FeedbackProvider,
  feedbackEvents,
  interfaceTypographyRoles,
  prefersReducedMotion,
  typographyRecipe,
} from "../index.ts"

const packageRoot = fileURLToPath(new URL("../..", import.meta.url))
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8")
const componentSources = Object.fromEntries(
  ["badge", "button", "card", "drawer", "field", "item", "label", "switch", "toast"].map(
    (component) => [
      component,
      readFileSync(new URL(`../components/ui/${component}.tsx`, import.meta.url), "utf8"),
    ],
  ),
)
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  dependencies?: Record<string, string>
  exports?: Record<string, string>
}

type Rgb = readonly [red: number, green: number, blue: number]

function linearChannel(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function hexLuminance(value: string): number {
  const numeric = Number.parseInt(value.slice(1), 16)
  const channels: Rgb = [numeric >> 16, (numeric >> 8) & 255, numeric & 255]
  const [red, green, blue] = channels.map(linearChannel) as unknown as Rgb
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

const clampColorChannel = (channel: number) => Math.max(0, Math.min(1, channel))

function oklchLuminance(value: string): number {
  const match = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value)
  if (match === null) {
    throw new Error(`Unsupported color: ${value}`)
  }

  const lightness = Number(match[1])
  const chroma = Number(match[2])
  const hue = (Number(match[3]) * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b
  const l = lRoot ** 3
  const m = mRoot ** 3
  const s = sRoot ** 3
  const red = clampColorChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const green = clampColorChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const blue = clampColorChannel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function relativeLuminance(value: string): number {
  return value.startsWith("#") ? hexLuminance(value) : oklchLuminance(value)
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

function variablesFor(selector: ":root" | ".dark"): Readonly<Record<string, string>> {
  const escaped = selector === ":root" ? ":root" : String.raw`\.dark`
  const block = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles)?.[1]
  if (block === undefined) {
    throw new Error(`Missing ${selector} token block`)
  }

  return Object.fromEntries(
    [...block.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((match) => {
      const name = match[1]
      const value = match[2]
      if (name === undefined || value === undefined) {
        throw new Error(`Malformed ${selector} token`)
      }
      return [name, value.trim()]
    }),
  )
}

function variable(variables: Readonly<Record<string, string>>, name: string): string {
  const value = variables[name]
  if (value === undefined) {
    throw new Error(`Missing color token --${name}`)
  }
  return value
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

  it("keeps the Maia status pairs at WCAG AA contrast", () => {
    const themes = {
      light: variablesFor(":root"),
      dark: variablesFor(".dark"),
    }

    for (const [theme, variables] of Object.entries(themes)) {
      for (const status of ["success", "warning", "error", "info"]) {
        expect(
          contrastRatio(variable(variables, `${status}-foreground`), variable(variables, status)),
          `${theme} ${status} foreground on base`,
        ).toBeGreaterThanOrEqual(4.5)
        expect(
          contrastRatio(variable(variables, status), variable(variables, `${status}-surface`)),
          `${theme} ${status} base on surface`,
        ).toBeGreaterThanOrEqual(4.5)
        for (const surface of ["background", "card"]) {
          expect(
            contrastRatio(variable(variables, status), variable(variables, surface)),
            `${theme} ${status} base on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it("keeps default Button and Badge text at WCAG AA without changing shadcn tokens", () => {
    const light = variablesFor(":root")
    const dark = variablesFor(".dark")

    expect(
      contrastRatio(variable(light, "primary-foreground"), variable(light, "primary")),
      "light primary foreground on primary",
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrastRatio(variable(dark, "background"), variable(dark, "primary")),
      "dark background ink on primary",
    ).toBeGreaterThanOrEqual(4.5)

    for (const component of ["button", "badge"]) {
      expect(componentSources[component]).toContain("dark:text-background")
    }
  })

  it("publishes the clean Maia fonts without the retired private type scale", () => {
    expect(styles).toContain('@import "@fontsource-variable/inter"')
    expect(styles).toContain('@import "@fontsource-variable/geist-mono"')
    expect(styles).not.toMatch(/--text-(caption|body|emphasis|heading|title|display):/)
    expect(styles).not.toContain("--brand")
    expect(styles).not.toContain("--pressed")
  })

  it("publishes the shared interface motion curves", () => {
    expect(styles).toContain("--ease-out: cubic-bezier(0.23, 1, 0.32, 1)")
    expect(styles).toContain("--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)")
    expect(styles).toContain("--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)")
    expect(componentSources.toast).toContain(
      "[transition:transform_300ms_var(--ease-out),opacity_300ms_var(--ease-out),height_150ms]",
    )
    expect(componentSources.toast).not.toContain("transform_500ms")
  })

  it("removes spatial motion while retaining brief non-spatial feedback", () => {
    expect(styles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
    expect(styles).toContain("animation-duration: 0.01ms")
    expect(styles).toMatch(
      /\[data-slot="drawer-overlay"\],\s*\[data-slot="drawer-popup"\],\s*\[data-slot="toast"\]\s*{\s*transition-duration: 0\.01ms !important;\s*}/s,
    )
    expect(styles).toMatch(
      /button,\s*\[data-slot="toggle"\]\s*{\s*transform: none !important;\s*}/s,
    )
    expect(styles).toMatch(
      /\[data-slot="button"\],\s*\[data-slot="toggle"\],\s*\[data-slot="toast-content"\]\s*{\s*transition-duration: 100ms !important;\s*}/s,
    )
    expect(styles).not.toMatch(/\*::after\s*{[^}]*transition-duration:/s)
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
    expect(FeedbackProvider).toBeTypeOf("function")
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

    for (const component of ["badge", "button", "card", "drawer", "field", "item", "label"]) {
      expect(componentSources[component]).toContain("typographyRecipe")
    }
    expect(componentSources.button).toContain("useFeedback")
  })
})
