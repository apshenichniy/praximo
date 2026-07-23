import { Outlet, createFileRoute } from "@tanstack/react-router"

import { AdminLoading } from "@/components/admin-loading.tsx"
import { AdminNotFound } from "@/components/admin-not-found.tsx"
import { AdminShell } from "@/components/admin-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { resolveAdminInitData } from "@/features/admin/admin-init-data.ts"
import { adminWorkspaceListQuery } from "@/features/admin/workspace-queries.ts"

// The admin surface is a client-only, English-only route tree
// (admin-surface.md). Its frame owns Telegram fullscreen behavior and safe-area
// layout; visual tokens come from the application-wide dark preset.
export const Route = createFileRoute("/admin")({
  ssr: false,
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
    <AdminShell>
      <TelegramFullscreen />
      <Outlet />
    </AdminShell>
  )
}
