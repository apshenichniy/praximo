import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"

import { AdminHero } from "@/components/admin-hero.tsx"
import { Alert, AlertDescription } from "@/components/ui/alert.tsx"
import { takeAdminNotice } from "@/features/admin/admin-notice.ts"
import { Section, SectionTitle } from "@/features/admin/components/section.tsx"
import { WorkspaceSearch } from "@/features/admin/components/workspace-search.tsx"
import {
  CreateWorkspaceLink,
  WorkspaceListCard,
  WorkspaceListEmpty,
  WorkspaceListItem,
  WorkspaceListNoMatches,
} from "@/features/admin/components/workspace-list.tsx"
import { adminWorkspaceListQuery } from "@/features/admin/workspace-queries.ts"

export const Route = createFileRoute("/admin/")({ component: AdminHome })
const adminRoute = getRouteApi("/admin")

// Admin copy is English-only (admin-surface.md): the admin is the solo operator,
// so the trilingual machinery that serves coaches never reaches these routes.
function AdminHome() {
  const { initData } = adminRoute.useLoaderData()
  const { data: workspaces } = useSuspenseQuery(adminWorkspaceListQuery(initData))
  const [search, setSearch] = useState("")
  const [notice, setNotice] = useState<string>()
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredWorkspaces = useMemo(
    () =>
      normalizedSearch
        ? workspaces.filter(
            (workspace) =>
              workspace.name.toLocaleLowerCase().includes(normalizedSearch) ||
              workspace.botUsername?.toLocaleLowerCase().includes(normalizedSearch),
          )
        : workspaces,
    [normalizedSearch, workspaces],
  )

  useEffect(() => {
    const message = takeAdminNotice()
    if (message !== undefined) setNotice(message)
  }, [])

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-14 pb-10">
      <AdminHero />

      {notice === undefined ? null : (
        <Alert className="mt-8">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <div className="mt-10">
        <WorkspaceSearch value={search} onChange={setSearch} />
      </div>

      <Section className="mt-10" aria-labelledby="workspaces-heading">
        <SectionTitle id="workspaces-heading">Workspaces</SectionTitle>
        <div className="mt-4">
          <WorkspaceListCard>
            <CreateWorkspaceLink />
            {workspaces.length === 0 ? (
              <WorkspaceListEmpty />
            ) : filteredWorkspaces.length === 0 ? (
              <WorkspaceListNoMatches query={search.trim()} onClear={() => setSearch("")} />
            ) : (
              filteredWorkspaces.map((workspace) => (
                <WorkspaceListItem key={workspace.id} workspace={workspace} />
              ))
            )}
          </WorkspaceListCard>
        </div>
      </Section>
    </main>
  )
}
