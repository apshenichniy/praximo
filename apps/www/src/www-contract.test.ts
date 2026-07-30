import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const root = fileURLToPath(new URL("..", import.meta.url))
const source = (path: string) => readFileSync(join(root, path), "utf8")

describe("WWW staged shell", () => {
  it("is static, shared-foundation owned, and noindex", () => {
    expect(source("astro.config.mjs")).toContain('output: "static"')
    expect(source("src/styles/app.css")).toContain('@import "@praximo/ui/styles.css"')
    /*
     * The public site owns its interface faces rather than taking the host's
     * (#255). The shared package ships no webfont at all, because its other
     * consumers are Telegram Mini Apps — so if this file does not load them,
     * the one surface whose job is to look like Praximo renders as the
     * visitor's operating system instead.
     */
    expect(source("src/styles/app.css")).toContain('@import "@fontsource-variable/inter"')
    expect(source("src/styles/app.css")).toContain('@import "@fontsource-variable/geist-mono"')
    expect(source("src/styles/app.css")).toMatch(/--font-sans:\s*"Inter Variable"/)
    expect(source("src/styles/app.css")).toMatch(/--font-mono:\s*"Geist Mono Variable"/)
    expect(source("src/layouts/PageLayout.astro")).toContain(
      '<meta name="robots" content="noindex,nofollow" />',
    )
    expect(source("public/_headers")).toContain("X-Robots-Tag: noindex, nofollow")
  })

  it("follows system theme without an application switch", () => {
    const layout = source("src/layouts/PageLayout.astro")

    expect(layout).toContain("prefers-color-scheme: dark")
    expect(layout).not.toContain("ThemeSwitch")
    expect(layout).not.toContain("localStorage")
  })

  it("keeps unresolved public launch decisions out of the staged shell", () => {
    const page = source("src/pages/index.astro")

    expect(page).toContain("Preview environment")
    expect(page).not.toMatch(/sign up|pricing|buy now/i)
  })
})
