import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  FeedbackButton,
  FeedbackProvider,
  feedbackEvents,
  interfaceTypographyRoles,
  prefersReducedMotion,
  typographyRecipe,
} from "../index.ts"

const packageRoot = fileURLToPath(new URL("../..", import.meta.url))
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8")
const componentSources = Object.fromEntries(
  readdirSync(new URL("../components/ui/", import.meta.url))
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => [
      file.replace(/\.tsx$/, ""),
      readFileSync(new URL(`../components/ui/${file}`, import.meta.url), "utf8"),
    ]),
)
const feedbackButtonSource = readFileSync(
  new URL("../components/feedback-button.tsx", import.meta.url),
  "utf8",
)
const primitive = (component: string): string => {
  const source = componentSources[component]
  if (source === undefined) {
    throw new Error(`Missing primitive source: ${component}`)
  }
  return source
}
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
  const blocks = [...styles.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))]
  if (blocks.length === 0) {
    throw new Error(`Missing ${selector} token block`)
  }

  return Object.fromEntries(
    blocks.flatMap((block) =>
      [...(block[1] ?? "").matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((match) => {
        const name = match[1]
        const value = match[2]
        if (name === undefined || value === undefined) {
          throw new Error(`Malformed ${selector} token`)
        }
        return [name, value.trim()]
      }),
    ),
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
        expect(variable(variablesFor(":root"), `${family}${token}`)).toMatch(/^oklch\(/)
        expect(variable(variablesFor(".dark"), `${family}${token}`)).toMatch(/^oklch\(/)
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

  it("keeps the live Maia/Violet primary pairs and primitive ink unchanged", () => {
    const light = variablesFor(":root")
    const dark = variablesFor(".dark")

    expect(variable(light, "primary")).toBe("oklch(0.491 0.27 292.581)")
    expect(variable(dark, "primary")).toBe("oklch(0.432 0.232 292.759)")

    expect(
      contrastRatio(variable(light, "primary-foreground"), variable(light, "primary")),
      "light primary foreground on primary",
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrastRatio(variable(dark, "primary-foreground"), variable(dark, "primary")),
      "dark primary foreground on primary",
    ).toBeGreaterThanOrEqual(4.5)

    for (const component of ["button", "badge"]) {
      expect(primitive(component)).toContain("text-primary-foreground")
      expect(primitive(component)).not.toContain("dark:text-background")
    }
  })

  it("publishes the clean Maia fonts without the retired private type scale", () => {
    expect(styles).toContain('@import "@fontsource-variable/inter"')
    expect(styles).toContain('@import "@fontsource-variable/geist-mono"')
    expect(styles).not.toMatch(/--text-(caption|body|emphasis|heading|title|display):/)
    expect(styles).not.toContain("--brand")
    expect(styles).not.toContain("--pressed")
  })

  it("keeps product motion tokens additive without rewriting primitive motion", () => {
    expect(styles).toContain("--ease-out: cubic-bezier(0.23, 1, 0.32, 1)")
    expect(styles).toContain("--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)")
    expect(styles).toContain("--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)")
    expect(primitive("toast")).toContain(
      "[transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
    )
    expect(primitive("drawer")).not.toContain("var(--ease")
    expect(primitive("toast")).not.toContain("var(--ease")
  })

  it("scopes reduced motion and feedback above the pure Button primitive", () => {
    expect(styles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
    expect(styles).toMatch(
      /\[data-praximo-feedback-button\]\s*{\s*transform: none !important;\s*transition-duration: 100ms !important;\s*}/s,
    )
    expect(feedbackButtonSource).toContain("data-praximo-feedback-button")
    expect(feedbackButtonSource).toContain("useFeedback")
    expect(primitive("button")).not.toContain("useFeedback")
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
    expect(FeedbackButton).toBeTypeOf("function")
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

  it("keeps the shadcn primitive directory free of Praximo styling and behavior", () => {
    for (const source of Object.values(componentSources)) {
      expect(source).not.toContain("typographyRecipe")
      expect(source).not.toContain("useFeedback")
      expect(source).not.toContain("data-praximo")
      expect(source).not.toContain("dark:text-background")
      expect(source).not.toContain("var(--ease")
    }

    expect(Object.keys(componentSources)).toHaveLength(24)
  })

  it("enables Tailwind font antialiasing at the shared body boundary", () => {
    expect(styles).toMatch(/body\s*{\s*@apply bg-background text-foreground antialiased;/s)
  })
})
