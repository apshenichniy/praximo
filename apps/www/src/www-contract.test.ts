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
