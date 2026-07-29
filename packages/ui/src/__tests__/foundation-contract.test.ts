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
const typeset = readFileSync(new URL("../typeset.css", import.meta.url), "utf8")
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

/** Every declaration of one flat rule, keyed by property. */
function declarationsFor(css: string, selector: string): Readonly<Record<string, string>> {
  const block = new RegExp(
    `(?:^|\\n)${selector.replace(".", String.raw`\.`)}\\s*\\{([^}]*)\\}`,
  ).exec(css)
  if (block === null) {
    throw new Error(`Missing rule ${selector}`)
  }

  return Object.fromEntries(
    [...(block[1] ?? "").matchAll(/([\w-]+):\s*([^;]+);/g)].map((match) => {
      const property = match[1]
      const value = match[2]
      if (property === undefined || value === undefined) {
        throw new Error(`Malformed declaration in ${selector}`)
      }
      return [property, value.trim()]
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

    // 26 since #57 added `dropdown-menu`, installed from the live registry and
    // left as upstream source: the Acceptance Page's header carries language and
    // appearance as buttons that open a list, and this package had no dropdown,
    // select or menu at all. Composing `popover` would have meant writing the
    // keyboard and focus behaviour of a menu by hand.
    //
    // 25 was #210's `collapsible`, for the hours the scheduling sheet hides.
    expect(Object.keys(componentSources)).toHaveLength(26)
  })

  it("enables Tailwind font antialiasing at the shared body boundary", () => {
    expect(styles).toMatch(/body\s*{\s*@apply bg-background text-foreground antialiased;/s)
  })

  it("publishes the prose layer as its own stylesheet, imported after Tailwind", () => {
    expect(packageJson.exports?.["./typeset.css"]).toBe("./src/typeset.css")
    expect(styles.indexOf('@import "./typeset.css"')).toBeGreaterThan(
      styles.indexOf('@import "tailwindcss"'),
    )
    expect(typeset).toContain("shadcn/typeset")
  })

  /**
   * The line #223 draws. Prose flow and interface roles are separate layers,
   * and neither is allowed to start deciding for the other: the stylesheet
   * carries no type scale of its own, and the presets carry nothing but the
   * three numbers it leaves open.
   */
  it("keeps the prose layer a mechanism rather than a second type scale", () => {
    for (const property of [
      "--typeset-font-body",
      "--typeset-font-heading",
      "--typeset-font-mono",
      "--typeset-size",
      "--typeset-leading",
      "--typeset-flow",
    ]) {
      expect(typeset, `${property} in the prose stylesheet`).toContain(`${property}:`)
    }

    // No absolute type scale: every size the stylesheet sets is relative to the
    // one number a preset chooses, so it cannot fork the interface scale.
    for (const [, value] of typeset.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(value, "absolute font-size in the prose stylesheet").toMatch(
        /^(?:inherit|[\d.]+em|calc\(var\(--typeset-size\)[^)]*\)|var\(--typeset-size\))$/,
      )
    }

    // Nor any vocabulary of its own. Everything it styles is an element or a
    // structural marker; the class names it knows are its own.
    const ownClasses = new Set([
      "typeset",
      "typeset-scroll",
      "not-typeset",
      "contains-task-list",
      "task-list-item",
      "footnotes",
    ])
    const typesetRules = typeset.replaceAll(/\/\*[\s\S]*?\*\//g, "")
    for (const [, className] of typesetRules.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
      expect(ownClasses, `class .${className} in the prose stylesheet`).toContain(className)
    }

    expect(typeset).not.toContain("typographyRecipe")
    expect(typeset).not.toContain("@apply")
    expect(typeset).not.toMatch(/--text-[a-z]/)
  })

  it("chooses the three numbers per preset and repoints the fonts at the product faces", () => {
    const presets = {
      ".typeset-document": { size: "15px", leading: "1.75", flow: "1.25em" },
      ".typeset-pane": { size: "14px", leading: "1.6", flow: "1em" },
    }

    for (const [selector, numbers] of Object.entries(presets)) {
      const declarations = declarationsFor(styles, selector)

      // Nothing but the six variables: a preset that reached for a colour or a
      // font-size would be forking the interface scale by another route.
      expect(new Set(Object.keys(declarations)), `${selector} declarations`).toEqual(
        new Set([
          "--typeset-font-body",
          "--typeset-font-heading",
          "--typeset-font-mono",
          "--typeset-size",
          "--typeset-leading",
          "--typeset-flow",
        ]),
      )

      // Inter Variable and Geist Mono by way of the shared theme, not the
      // Geist the Typeset builder emits by default.
      expect(declarations["--typeset-font-body"]).toBe("var(--font-sans)")
      expect(declarations["--typeset-font-heading"]).toBe("var(--font-heading)")
      expect(declarations["--typeset-font-mono"]).toBe("var(--font-mono)")
      expect(declarations["--typeset-size"]).toBe(numbers.size)
      expect(declarations["--typeset-leading"]).toBe(numbers.leading)
      expect(declarations["--typeset-flow"]).toBe(numbers.flow)
    }

    // The whole chain, not just its first link: a preset points at a theme
    // variable, the variable names a face, and the face is actually loaded.
    // Where it resolves is checked in the browser; that it can is checked here.
    expect(styles).toMatch(/--font-sans:\s*"Inter Variable"/)
    expect(styles).toMatch(/--font-mono:\s*"Geist Mono Variable"/)
    expect(styles).toMatch(/--font-heading:\s*var\(--font-sans\)/)
    expect(styles).toContain('@import "@fontsource-variable/inter"')
    expect(styles).toContain('@import "@fontsource-variable/geist-mono"')
  })
})
