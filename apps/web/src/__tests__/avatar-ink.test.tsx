import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { entryMarkClass } from "@/features/entry/components/entry-frame.tsx"
import { WorkspaceAvatar } from "@/features/admin/components/workspace-avatar.tsx"

const classesOf = (html: string, slot: string): ReadonlyArray<string> => {
  const match = new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"`).exec(html)
  return (match?.[1] ?? "").split(" ")
}

describe("the workspace avatar", () => {
  it("prints its initials in the disc's own ink", () => {
    const classes = classesOf(
      renderToStaticMarkup(<WorkspaceAvatar name="Alex Coach" />),
      "avatar-fallback",
    )

    expect(classes).toContain("admin-avatar")
    expect(classes).toContain("text-white")
    // The fallback primitive ships a muted ink for the grey disc it assumes.
    // `admin-avatar` carries `text-white` behind `@apply`, where tailwind-merge
    // cannot see it, so without the colour named here both survive the merge and
    // the muted one wins in the cascade — grey initials on the violet ground.
    expect(classes).not.toContain("text-muted-foreground")
  })

  it("still takes its size from the caller", () => {
    const html = renderToStaticMarkup(
      <WorkspaceAvatar name="Alex Coach" className="size-24" fallbackClassName="text-display" />,
    )

    expect(classesOf(html, "avatar")).toContain("size-24")
    expect(classesOf(html, "avatar-fallback")).toContain("text-display")
    expect(classesOf(html, "avatar-fallback")).not.toContain("text-body")
    // The caller sized it; the ink is still the component's decision.
    expect(classesOf(html, "avatar-fallback")).toContain("text-white")
  })

  it("renders initials rather than a mark", () => {
    const html = renderToStaticMarkup(<WorkspaceAvatar name="Alex Coach" />)

    expect(html).toContain("AC")
    expect(html).not.toContain("<svg")
  })
})

describe("the entry frame's brand mark", () => {
  it("leaves the disc's ink alone, having no colour of its own to state", () => {
    // The counterpart to the avatar: nothing here competes with `admin-avatar`,
    // so the icon inherits its white and the utility needs no help.
    expect(entryMarkClass("brand")).not.toMatch(/\btext-/)
    expect(entryMarkClass("muted")).toContain("text-muted-foreground")
  })
})
