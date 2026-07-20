import { Outlet, createFileRoute } from "@tanstack/react-router"

import { AdminThemeShell } from "@/components/admin-theme-shell.tsx"
import adminCss from "@/styles/admin.css?url"

// The admin surface is a self-contained route tree (admin-surface.md): its own
// layout, its own theme, English-only. The theme stylesheet is attached on this
// layout route, so TanStack only emits its <link> when an /admin route matches —
// code-split out of the coach bundle, and absent from every coach page.
export const Route = createFileRoute("/admin")({
  head: () => ({ links: [{ rel: "stylesheet", href: adminCss }] }),
  component: AdminLayout,
})

function AdminLayout() {
  return (
    <AdminThemeShell>
      <Outlet />
    </AdminThemeShell>
  )
}
