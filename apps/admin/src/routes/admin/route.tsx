import { Outlet, createFileRoute, useRouter } from "@tanstack/react-router"
import { useCallback } from "react"

import { AdminNotFound } from "@/components/admin-not-found.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { EntryLoading } from "@/components/entry-loading.tsx"
import { HostFullscreen } from "@/presentation-host"
import { Toaster } from "@praximo/ui/components/toast"
import { EntryScreen } from "@/features/entry/components/entry-screen.tsx"
import { entryView } from "@/features/entry/entry-view.ts"
import { viewerRoleQuery } from "@/features/entry/role-queries.ts"
import { adminWorkspaceListQuery } from "@/features/admin/workspace-queries.ts"

// The manager Mini App's universal entry (#106). Both of the manager bot's
// "Open" surfaces land here, so this route resolves *who is looking* before it
// renders anything: the admin tree behind the Outlet, or the one screen that
// viewer's role earns. Client-only and English-only (admin-surface.md); its
// frame owns Telegram fullscreen behavior and safe-area layout, and visual
// tokens come from the application-wide dark preset.
export const Route = createFileRoute("/admin")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  // Role-neutral by necessity: the pending frame paints before the gate has an
  // answer, so it must belong to no role in particular.
  pendingComponent: EntryLoading,
  notFoundComponent: AdminNotFound,
  loader: async ({ context }) => {
    // Re-run the gate on every route entry. A cached role is the one value that
    // must not survive a revocation, so the query itself keeps nothing. A gate
    // that cannot answer at all — the fetch itself failing — is a screen of its
    // own rather than the router's error boundary: the viewer still has no role,
    // and "we couldn't open Praximo" is the honest thing to say about that.
    const result = await context.queryClient
      .fetchQuery(viewerRoleQuery())
      .catch(() => ({ ok: false, error: "server" }) as const)
    const view = entryView(result)

    // The list is fetched only once the viewer is known to be an admin: for
    // everyone else it would be a request that can only be refused.
    if (view.kind === "admin") {
      await context.queryClient.fetchQuery({
        ...adminWorkspaceListQuery(),
        staleTime: 0,
      })
    }
    return { view }
  },
  component: EntryLayout,
})

function EntryLayout() {
  const { view } = Route.useLoaderData()
  const router = useRouter()
  // A failed gate is retried by re-running it: invalidating re-enters the
  // loader, and the credential rides along on the request it makes.
  const retry = useCallback(() => void router.invalidate(), [router])

  return (
    <MiniAppShell>
      <HostFullscreen />
      <Toaster>
        {view.kind === "admin" ? <Outlet /> : <EntryScreen view={view} onRetry={retry} />}
      </Toaster>
    </MiniAppShell>
  )
}
