import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * One design system, two apps, and no package holding it (#191).
 *
 * The tokens are duplicated between `apps/web` and `apps/client` on purpose:
 * there is one real consumer of this system and a second with almost no screens
 * written, and extracting `@praximo/theme` now would be guessing at which
 * divergences the client surface actually needs. `docs/spec/design-system/apply.py`
 * writes both copies from one spec instead — see that directory's README for the
 * trigger that would make the package worth it.
 *
 * Which leaves exactly one failure mode: somebody edits one app's tokens by hand,
 * or runs nothing at all after changing the spec. That is silent — both apps
 * render, and only the Telegram chrome or a status tint quietly disagrees. This
 * is the alarm.
 *
 * **Scoped to the token blocks**, not to the whole file, and that is the point.
 * The two apps are meant to be able to differ: the client app has no coach day
 * strip, and its type scale may yet take a desktop step the Mini App must not.
 * What may not differ is the palette, because that is the product's identity and
 * the thing every contrast invariant is written against.
 */
const appCss = (app: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../${app}/src/styles/app.css`, import.meta.url)),
    "utf8",
  )

/** The `:root` … `.dark` pair, exactly as `apply.py` writes it. */
const tokenBlocks = (source: string, app: string): string => {
  const blocks = /:root \{.*?\n\}\n\n\.dark \{.*?\n\}/s.exec(source)?.[0]
  if (blocks === undefined) {
    throw new Error(`${app}/src/styles/app.css has no \`:root\` … \`.dark\` pair`)
  }
  return blocks
}

describe("design system parity", () => {
  it("carries the same tokens in both apps", () => {
    const web = tokenBlocks(appCss("web"), "web")
    const client = tokenBlocks(appCss("client"), "client")

    // A rename or a restructure that made either side unreadable would otherwise
    // turn this into a test comparing two empty strings.
    expect(web).toContain("--background:")
    expect(web).toContain("--brand:")
    expect(client).toBe(web)
  })

  it("keeps the two apps free to differ outside the palette", () => {
    // Stated as an assertion rather than as a comment, because it is what the
    // scoping above buys and the first hand-edit will otherwise erase it: the
    // coach's scroll-driven day strip is not in the client app, and this test
    // passing while that is true is the whole design.
    expect(appCss("web")).toContain("[data-strip-day]")
    expect(appCss("client")).not.toContain("[data-strip-day]")
  })
})
