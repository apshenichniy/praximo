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
  it("consumes the shared Maia stylesheet without owning a token copy", () => {
    const root = src("routes/__root.tsx")
    const appCss = src("styles/app.css")

    expect(root).toContain("app.css?url")
    expect(appCss).toContain('@import "@praximo/ui/styles.css"')
    expect(appCss).not.toMatch(/:root\s*{/)
    expect(appCss).not.toMatch(/\.dark\s*{/)
    expect(root).toContain("background:${APP_BACKGROUND_COLOR.light}")
    // The first paint declares the stack even though the stylesheet declares
    // it too: with no font-family at all a document opens in the browser's
    // standard font, which is a serif, so the flash this prevents is real
    // even once the interface sans is the host's own (#255).
    expect(root).toContain("font-family:system-ui,sans-serif")
    // A named family here would be a webfont sneaking back in ahead of the
    // stylesheet, where nothing else in the suite would see it.
    expect(root).not.toMatch(/font-family:[^}]*["']/)
    expect(root).toContain("color:${APP_FOREGROUND_COLOR.dark}")
    expect(APP_BACKGROUND_COLOR.light).toMatch(/^#[0-9a-f]{6}$/)
    expect(APP_FOREGROUND_COLOR.dark).toMatch(/^#[0-9a-f]{6}$/)
    expect(root).toContain("THEME_BOOTSTRAP")
  })

  it("renders the document scheme-less so the bootstrap can settle it", () => {
    const root = src("routes/__root.tsx")

    // A class here would be the server guessing: the reader's preference lives
    // in their browser's storage, which no request carries.
    // Not a literal: the document declares the language it is actually in, and
    // these pages are a contract in three of them.
    expect(root).toContain("<html lang={useDocumentLanguage()} suppressHydrationWarning>")
    expect(root).not.toContain('className="dark"')
    expect(root).toContain("<ClientTheme />")
  })

  /**
   * The reason this app exists as its own Worker (#191). Telegram-hosted apps load
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

  it("keeps the Worker private and has no Telegram presentation host", () => {
    const root = src("routes/__root.tsx")

    expect(root).toContain('{ name: "robots", content: "noindex,nofollow" }')
    expect(root).toContain("<FeedbackProvider>")
  })
})
