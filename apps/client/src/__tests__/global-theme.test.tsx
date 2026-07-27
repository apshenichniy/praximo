import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { APP_BACKGROUND_COLOR, APP_FOREGROUND_COLOR } from "@/lib/theme.ts"

const srcRoot = fileURLToPath(new URL("..", import.meta.url))

const src = (rel: string) => readFileSync(join(srcRoot, rel), "utf8")

/** Prose out, code in. Good enough here: no string in this app contains `//`. */
const withoutComments = (source: string): string =>
  source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/[^\n]*/g, "")

const sourcesUnder = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourcesUnder(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })

describe("global application theme", () => {
  it("loads one global stylesheet and paints both grounds in the document head", () => {
    const root = src("routes/__root.tsx")
    const appCss = src("styles/app.css")
    const light = appCss.match(/:root\s*{[^}]*--background:\s*([^;]+);/s)?.[1]
    const dark = appCss.match(/\.dark\s*{[^}]*--background:\s*([^;]+);/s)?.[1]

    expect(root).toContain("app.css?url")
    // The critical stylesheet carries both, because which one it will be is not
    // known until the bootstrap script runs a few bytes further down the head.
    expect(root).toContain(`const lightBackground = "${light}"`)
    expect(root).toContain(`const darkBackground = "${dark}"`)
    // Each colour is declared twice: the hex a browser without oklch falls back
    // to, then the token's own value.
    expect(root).toContain("background:${APP_BACKGROUND_COLOR.light}")
    expect(root).toContain("color:${APP_FOREGROUND_COLOR.dark}")
    expect(APP_BACKGROUND_COLOR.light).toMatch(/^#[0-9a-f]{6}$/)
    expect(APP_FOREGROUND_COLOR.dark).toMatch(/^#[0-9a-f]{6}$/)
    expect(root).toContain("THEME_BOOTSTRAP")
  })

  it("renders the document scheme-less so the bootstrap can settle it", () => {
    const root = src("routes/__root.tsx")

    // A class here would be the server guessing: the reader's preference lives
    // in their browser's storage, which no request carries.
    expect(root).toContain('<html lang="en" suppressHydrationWarning>')
    expect(root).not.toContain('className="dark"')
    expect(root).toContain("<ClientTheme />")
  })

  /**
   * The reason this app exists as its own Worker (#191). `apps/web` loads
   * Telegram's SDK on every route, `/legal/privacy` included — the page a client
   * reads before agreeing to anything. A person who is not on Telegram should
   * not be served Telegram's runtime to read a privacy policy.
   *
   * Asserted over the whole tree rather than over the root alone: the script tag
   * is one `head()` entry away on any route, and a component copied from the
   * other app is how it would arrive.
   */
  it("serves no Telegram runtime on any route", () => {
    const offenders = sourcesUnder(srcRoot)
      .filter((path) => !/\.test\.tsx?$/.test(path))
      // Comments are stripped first, and they have to be: the files that most
      // need this rule are the ones that explain why Telegram is absent, and a
      // plain text search would read their reasoning as the offence.
      .filter((path) =>
        /telegram-web-app|window\.Telegram|@praximo\/telegram/.test(
          withoutComments(readFileSync(path, "utf8")),
        ),
      )

    expect(offenders.map((path) => path.slice(srcRoot.length))).toEqual([])
  })

  it("uses Inter, with the light ground at the root and dark as the override", () => {
    const appCss = src("styles/app.css")

    // The optical-size build, not the weight-only one — see §Typography. Served
    // from fontsource, in the bundle, never from a CDN.
    expect(appCss).toContain('@import "@fontsource-variable/inter/opsz.css"')
    expect(appCss).toContain('--font-sans: "Inter Variable"')
    expect(appCss).toContain("font-optical-sizing: auto")
    expect(appCss).toMatch(/:root\s*{[^}]*color-scheme:\s*light/s)
    expect(appCss).toMatch(/\.dark\s*{[^}]*color-scheme:\s*dark/s)
  })

  it("states status by meaning, so each scheme picks its own shade", () => {
    const appCss = src("styles/app.css")

    for (const token of ["--success", "--warning", "--info"]) {
      expect(appCss).toMatch(new RegExp(`:root\\s*{[^}]*${token}:`, "s"))
      expect(appCss).toMatch(new RegExp(`\\.dark\\s*{[^}]*${token}:`, "s"))
    }

    // A shade picked for one ground is unreadable on the other — `emerald-300`
    // is a word on near-black and a tint on white — so no screen names one.
    const offenders = sourcesUnder(srcRoot).filter((path) =>
      /\b(?:bg|text|ring|border|from|to|via)-(?:emerald|amber|rose|sky|green|red|yellow|blue)-\d{2,3}\b/.test(
        readFileSync(path, "utf8"),
      ),
    )

    expect(offenders.map((path) => path.slice(srcRoot.length))).toEqual([])
  })
})
