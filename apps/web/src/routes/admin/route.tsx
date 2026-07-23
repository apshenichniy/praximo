import { Outlet, createFileRoute } from "@tanstack/react-router"

import { AdminLoading } from "@/components/admin-loading.tsx"
import { AdminNotFound } from "@/components/admin-not-found.tsx"
import { AdminThemeShell } from "@/components/admin-theme-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { resolveAdminInitData } from "@/features/admin/admin-init-data.ts"
import { adminWorkspaceListQuery } from "@/features/admin/workspace-queries.ts"
import adminCss from "@/styles/admin.css?url"

// The admin surface is a self-contained route tree (admin-surface.md): its own
// layout, its own theme, English-only. The theme stylesheet is attached on this
// layout route, so TanStack only emits its <link> when an /admin route matches —
// code-split out of the coach bundle, and absent from every coach page.
export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({ links: [{ rel: "stylesheet", href: adminCss }] }),
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: AdminLoading,
  notFoundComponent: AdminNotFound,
  loader: async ({ context }) => {
    const initData = await resolveAdminInitData()
    await context.queryClient.fetchQuery({
      ...adminWorkspaceListQuery(initData),
      // Re-run both HMAC and the DB admin gate on every route entry. Returning
      // cached data here could expose a list after access was revoked.
      staleTime: 0,
    })
    return { initData }
  },
  component: AdminLayout,
})

function AdminLayout() {
  return (
    <AdminThemeShell>
      <TelegramFullscreen />
      <Outlet />
    </AdminThemeShell>
  )
}
