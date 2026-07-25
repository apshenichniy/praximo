import { Outlet, createFileRoute, useRouter } from "@tanstack/react-router"
import { useCallback } from "react"

import { AdminNotFound } from "@/components/admin-not-found.tsx"
import { AdminShell } from "@/components/admin-shell.tsx"
import { EntryLoading } from "@/components/entry-loading.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { Toaster } from "@/components/ui/toast.tsx"
import { EntryScreen } from "@/features/entry/components/entry-screen.tsx"
import { entryView } from "@/features/entry/entry-view.ts"
import { resolveManagerInitData } from "@/features/entry/manager-init-data.ts"
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
  // Resolved in `beforeLoad` rather than in the loader so child routes can
  // prefetch their own data: a loader's return value is private to its match,
  // but whatever `beforeLoad` returns joins the context every child sees.
  beforeLoad: async () => ({ initData: await resolveManagerInitData() }),
  loader: async ({ context }) => {
    // Re-run the gate on every route entry. A cached role is the one value that
    // must not survive a revocation, so the query itself keeps nothing. A gate
    // that cannot answer at all — the fetch itself failing — is a screen of its
    // own rather than the router's error boundary: the viewer still has no role,
    // and "we couldn't open Praximo" is the honest thing to say about that.
    const result = await context.queryClient
      .fetchQuery(viewerRoleQuery(context.initData))
      .catch(() => ({ ok: false, error: "server" }) as const)
    const view = entryView(result)

    // The list is fetched only once the viewer is known to be an admin: for
    // everyone else it would be a request that can only be refused.
    if (view.kind === "admin") {
      await context.queryClient.fetchQuery({
        ...adminWorkspaceListQuery(context.initData),
        staleTime: 0,
      })
    }
    // The viewer's coach hat travels alongside the view rather than inside its
    // admin variant: the admin screens read it for #107's contextual action,
    // and a field they can reach without narrowing keeps that a plain lookup.
    return {
      initData: context.initData,
      view,
      coach: result.ok ? result.role.coach : null,
    }
  },
  component: EntryLayout,
})

function EntryLayout() {
  const { view } = Route.useLoaderData()
  const router = useRouter()
  // A failed gate is retried by re-running it: invalidating re-enters
  // `beforeLoad` and the loader, credential read included.
  const retry = useCallback(() => void router.invalidate(), [router])

  return (
    <AdminShell>
      <TelegramFullscreen />
      <Toaster>
        {view.kind === "admin" ? <Outlet /> : <EntryScreen view={view} onRetry={retry} />}
      </Toaster>
    </AdminShell>
  )
}
