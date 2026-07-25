import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MiniAppShell } from "@/components/mini-app-shell.tsx"

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8")

describe("global application theme", () => {
  it("loads one global stylesheet and declares the dark first paint in the document head", () => {
    const root = src("routes/__root.tsx")
    const adminRoute = src("routes/admin/route.tsx")
    const appCss = src("styles/app.css")
    const background = appCss.match(/--background:\s*([^;]+);/)?.[1]
    const foreground = appCss.match(/--foreground:\s*([^;]+);/)?.[1]

    expect(root).toContain("app.css?url")
    expect(root).toContain(`const darkBackground = "${background}"`)
    expect(root).toContain(`const darkForeground = "${foreground}"`)
    expect(root).toContain(`background:\${darkThemeColor}`)
    expect(root).toContain("color:${darkForeground}")
    expect(root).toContain('name: "theme-color", content: darkThemeColor')
    expect(root).toContain("scripts: [{ src: TELEGRAM_WEBAPP_SRC }]")
    expect(adminRoute).not.toContain("admin.css")
  })

  it("uses Nunito Sans and dark preset tokens at the root", () => {
    const appCss = src("styles/app.css")

    expect(appCss).toContain('@import "@fontsource-variable/nunito-sans')
    expect(appCss).toMatch(/:root\s*{[^}]*color-scheme:\s*dark/s)
    expect(appCss).toContain('--font-sans: "Nunito Sans Variable"')
    expect(appCss).not.toMatch(/\.dark\s*{/)
  })

  it("does not retain a route-scoped admin theme", () => {
    const adminCssPath = fileURLToPath(new URL("../styles/admin.css", import.meta.url))
    const html = renderToStaticMarkup(
      <MiniAppShell>
        <span>content</span>
      </MiniAppShell>,
    )

    expect(existsSync(adminCssPath)).toBe(false)
    expect(html).not.toContain("data-theme")
  })
})
