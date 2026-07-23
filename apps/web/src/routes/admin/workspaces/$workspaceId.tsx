import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { adminWorkspaceListQuery } from "@/features/admin/workspace-queries.ts"

export const Route = createFileRoute("/admin/workspaces/$workspaceId")({
  component: WorkspaceDetailsPlaceholder,
})

const adminRoute = getRouteApi("/admin")

function WorkspaceDetailsPlaceholder() {
  const { workspaceId } = Route.useParams()
  const { initData } = adminRoute.useLoaderData()
  const { data: workspaces } = useSuspenseQuery(adminWorkspaceListQuery(initData))
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
  if (!workspace) throw notFound()

  const statusLabel =
    workspace.botStatus === "needs-relink"
      ? "Needs re-link"
      : workspace.botStatus === "connected"
        ? "Connected"
        : "Provisioning"

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-5 pb-10">
      <TelegramBackButton />

      <section className="mt-8 text-center">
        <div className="admin-avatar mx-auto flex size-24 items-center justify-center rounded-full text-3xl font-semibold">
          {workspace.name.charAt(0).toUpperCase()}
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{workspace.name}</h1>
        {workspace.botUsername ? (
          <p className="text-muted-foreground mt-2">@{workspace.botUsername}</p>
        ) : null}
      </section>

      <section className="bg-card ring-border mt-10 rounded-2xl p-5 ring-1">
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          Bot status
        </p>
        <p className="mt-2 text-lg font-medium">{statusLabel}</p>
        <p className="text-muted-foreground mt-5 text-sm leading-6">
          Workspace profile, status details, and actions arrive in the next workspace ticket.
        </p>
      </section>
    </main>
  )
}
