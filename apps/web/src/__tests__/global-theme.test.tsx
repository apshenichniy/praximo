import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { APP_BACKGROUND_COLOR, APP_FOREGROUND_COLOR } from "@/lib/theme.ts"

const srcRoot = fileURLToPath(new URL("..", import.meta.url))

const src = (rel: string) => readFileSync(join(srcRoot, rel), "utf8")

const sourcesUnder = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourcesUnder(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })

describe("global application theme", () => {
  it("loads one global stylesheet and paints both grounds in the document head", () => {
    const root = src("routes/__root.tsx")
    const adminRoute = src("routes/admin/route.tsx")
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
    expect(root).toContain("COLOR_SCHEME_BOOTSTRAP")
    expect(root).toContain("scripts: [{ src: TELEGRAM_WEBAPP_SRC }]")
    expect(adminRoute).not.toContain("admin.css")
  })

  it("renders the document scheme-less so the bootstrap can settle it", () => {
    const root = src("routes/__root.tsx")

    // A class here would be the server guessing: Telegram publishes the scheme
    // in the URL hash, which no request carries.
    expect(root).toContain('<html lang="en" suppressHydrationWarning>')
    expect(root).not.toContain('className="dark"')
    expect(root).toContain("<TelegramTheme />")
  })

  it("uses Inter, with the preset's light ground at the root and dark as the override", () => {
    const appCss = src("styles/app.css")

    // The optical-size build, not the weight-only one — see §Typography.
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

  it("does not retain a route-scoped admin theme", () => {
    const adminCssPath = join(srcRoot, "styles/admin.css")
    const html = renderToStaticMarkup(
      <MiniAppShell>
        <span>content</span>
      </MiniAppShell>,
    )

    expect(existsSync(adminCssPath)).toBe(false)
    expect(html).not.toContain("data-theme")
  })
})
