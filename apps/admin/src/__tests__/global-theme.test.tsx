import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { APP_BACKGROUND_COLOR, APP_FOREGROUND_COLOR, APP_SURFACE_COLOR } from "@/mini-app.tsx"

const srcRoot = fileURLToPath(new URL("..", import.meta.url))

const src = (rel: string) => readFileSync(join(srcRoot, rel), "utf8")

describe("global application theme", () => {
  it("consumes the shared Maia stylesheet without owning a token copy", () => {
    const root = src("routes/__root.tsx")
    const appCss = src("styles/app.css")

    expect(root).toContain("app.css?url")
    expect(appCss).toContain('@import "@praximo/ui/styles.css"')
    expect(appCss).not.toMatch(/:root\s*{/)
    expect(appCss).not.toMatch(/\.dark\s*{/)
    expect(root).toContain("background:${APP_BACKGROUND_COLOR.light}")
    // The pre-stylesheet paint names the interface sans literally, so it is the
    // one place the shared token cannot reach and the one that drifts in
    // silence: the first paint would land in the fallback and then swap, which
    // is the exact flash this declaration exists to prevent (#255).
    expect(root).toContain(`font-family:"Ficus"`)
    expect(root).not.toContain("Inter Variable")
    expect(root).toContain("color:${APP_FOREGROUND_COLOR.dark}")
    expect(APP_BACKGROUND_COLOR.light).toMatch(/^#[0-9a-f]{6}$/)
    expect(APP_FOREGROUND_COLOR.dark).toMatch(/^#[0-9a-f]{6}$/)
    expect(APP_BACKGROUND_COLOR.light).toBe("#ffffff")
    expect(APP_SURFACE_COLOR.light).toBe("#ffffff")
  })

  it("lets the host settle the scheme before rendering", () => {
    const root = src("routes/__root.tsx")

    expect(root).toContain('<html lang="en" suppressHydrationWarning>')
    expect(root).not.toContain('className="dark"')
    expect(root).toContain("COLOR_SCHEME_BOOTSTRAP")
    expect(root).toContain("scripts: [{ src: TELEGRAM_WEBAPP_SRC }]")
    expect(root).toContain("<HostTheme />")
  })

  it("adapts shared feedback and keeps the Worker private", () => {
    const root = src("routes/__root.tsx")

    expect(root).toContain("<FeedbackProvider adapter={presentationFeedback}>")
    expect(root).toContain('{ name: "robots", content: "noindex,nofollow" }')
    expect(root).toContain('{ title: "Praximo Admin" }')
  })
})
