import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { PraximoMark } from "@/components/praximo-mark.tsx"
import { WorkspaceAvatar } from "@/features/admin/components/workspace-avatar.tsx"

const srcRoot = fileURLToPath(new URL("..", import.meta.url))

const src = (rel: string) => readFileSync(join(srcRoot, rel), "utf8")

/** Every `id="…"` the markup defines, in order, duplicates included. */
const declaredIds = (html: string): ReadonlyArray<string> =>
  [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1] ?? "")

/** Every `url(#…)` the markup points at. */
const referencedIds = (html: string): ReadonlyArray<string> =>
  [...html.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1] ?? "")

/** The four screens that carried the placeholder letter (#173). */
const markCallSites = [
  "components/admin-hero.tsx",
  "components/entry-loading.tsx",
  "components/admin-not-found.tsx",
  "features/coach/components/language-step.tsx",
] as const

describe("the Praximo mark", () => {
  it("draws the artwork inline, so a mark never waits on the network", () => {
    const html = renderToStaticMarkup(<PraximoMark size={96} />)

    expect(html).toContain("<svg")
    expect(html).not.toContain("<img")
    // No `src`, no external `href`: the paths and gradients are in the document.
    expect(html).not.toMatch(/\b(?:src|xlink:href)=/)
    expect(html).toContain("<path")
    // `xmlns` names the SVG namespace and is never fetched; nothing else in the
    // markup may carry an address.
    expect(html.replaceAll(/ xmlns="[^"]*"/g, "")).not.toContain("http")
  })

  it("is sized by prop, in both grounds' copies", () => {
    const html = renderToStaticMarkup(<PraximoMark size={56} />)
    const sized = [...html.matchAll(/width="(\d+)" height="(\d+)"/g)]

    expect(sized).toHaveLength(2)
    for (const [, width, height] of sized) {
      expect(width).toBe("56")
      expect(height).toBe("56")
    }
  })

  it("carries one copy per ground and shows exactly one of them", () => {
    const html = renderToStaticMarkup(<PraximoMark size={80} />)

    // Which scheme it will be is not known when this renders — the bootstrap
    // script settles the class before the first paint — so CSS chooses, and
    // both copies ship. See routes/__root.tsx.
    expect(html).toContain("dark:hidden")
    expect(html).toContain("hidden dark:block")
  })

  it("keeps its gradient ids to itself when two marks share a page", () => {
    const html = renderToStaticMarkup(
      <>
        <PraximoMark size={24} />
        <PraximoMark size={24} />
      </>,
    )
    const ids = declaredIds(html)

    // Duplicate ids in one document make the first definition win for everyone,
    // which silently paints one mark in the other's scheme.
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
    // Every gradient a path points at is one this markup defines.
    for (const reference of referencedIds(html)) {
      expect(ids).toContain(reference)
    }
    // Fragment references are looked up verbatim, so the generated ids stay
    // within characters that need no escaping anywhere they are written.
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z][A-Za-z0-9-]*$/)
    }
    // The same gradient, in two marks, must land on two ids — the assertions
    // above would all hold if the unique segment came out empty.
    const orbits = ids.filter((id) => id.startsWith("praximo-mark-light-orbit-back"))
    expect(orbits).toHaveLength(0)
    expect(ids.filter((id) => id.endsWith("-orbit-back"))).toHaveLength(4)
  })

  it("is decorative: the screens carrying it say Praximo in words", () => {
    const html = renderToStaticMarkup(<PraximoMark size={24} />)

    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain("<title")
    expect(html).not.toContain("aria-label")
  })

  it("still draws what the masters draw", () => {
    // The component transcribes the approved artwork rather than fetching it,
    // which is what keeps a mark off the network — so nothing but this test
    // notices when a master is redrawn and the transcription is left behind.
    const component = src("components/praximo-mark.tsx")

    for (const theme of ["light", "dark"] as const) {
      const master = readFileSync(
        join(srcRoot, `../../../assets/branding/coach-bot/${theme}/avatar-transparent.svg`),
        "utf8",
      )

      const paths = [...master.matchAll(/\bd="([^"]+)"/g)].map((match) => match[1] ?? "")
      expect(paths).toHaveLength(3)
      for (const path of paths) expect(component).toContain(path)

      const colours = new Set(
        [...master.matchAll(/(?:stop-color|fill)="(#[0-9a-f]{3,6})"/g)].map(
          (match) => match[1] ?? "",
        ),
      )
      expect(colours.size).toBeGreaterThan(5)
      for (const colour of colours) expect(component).toContain(colour)
    }
  })
})

describe("the screens that carried the placeholder letter", () => {
  it("draw the mark instead of the letter P", () => {
    for (const path of markCallSites) {
      const source = src(path)

      expect(source).toContain("PraximoMark")
      // The letter as a standalone child of an element — how all four wrote it.
      expect(source).not.toMatch(/>\s*P\s*</)
    }
  })

  it("leaves per-workspace avatars on their initials", () => {
    const html = renderToStaticMarkup(<WorkspaceAvatar name="Anna Smith" />)

    // An initial is right for a workspace: the brand mark there would claim
    // every coach's workspace is Praximo's (#173).
    expect(html).toContain("AS")
    expect(html).not.toContain("<svg")
    expect(src("styles/app.css")).toContain("@utility admin-avatar")
  })
})
