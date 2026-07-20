import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AdminThemeShell } from "@/components/admin-theme-shell.tsx"

// Vitest's Node env resolves `?url` asset imports to "", so the deployed
// stylesheet URLs are asserted at the build (separate admin-*/coach-* assets,
// verified on deploy). These checks pin the isolation invariants that *are*
// deterministic in Node: the route→stylesheet wiring and the CSS scoping.
const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8")

describe("admin theme isolation", () => {
  it("links the admin stylesheet from the admin route only, never the coach root", () => {
    const root = src("routes/__root.tsx")
    const adminRoute = src("routes/admin/route.tsx")

    expect(root).toContain("coach.css?url")
    expect(root).not.toContain("admin.css")
    expect(adminRoute).toContain("admin.css?url")
  })

  it('confines every admin design token under the [data-theme="admin"] scope', () => {
    const adminCss = src("styles/admin.css")

    // No admin token sits on a global selector — a coach route can never inherit one.
    expect(adminCss).not.toMatch(/(^|})\s*:root\s*{/)

    // Strip the scoped blocks; nothing with a custom-property declaration is left.
    const outsideScope = adminCss.replace(/\[data-theme="admin"]\s*{[^}]*}/g, "")
    expect(outsideScope).not.toMatch(/--[a-z-]+\s*:/)
  })

  it("wraps admin content in the isolated theme scope", () => {
    const html = renderToStaticMarkup(
      <AdminThemeShell>
        <span>content</span>
      </AdminThemeShell>,
    )

    expect(html).toContain('data-theme="admin"')
  })
})
