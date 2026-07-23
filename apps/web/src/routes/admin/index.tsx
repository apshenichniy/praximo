import { AddCircleIcon, ArrowRight01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { AdminHero } from "@/components/admin-hero.tsx"
import { adminWorkspaceListQuery } from "@/features/admin/workspace-queries.ts"

export const Route = createFileRoute("/admin/")({ component: AdminHome })
const adminRoute = getRouteApi("/admin")

const statusPresentation = {
  provisioning: {
    label: "Provisioning",
    className: "bg-amber-400/12 text-amber-300 ring-amber-400/20",
  },
  connected: {
    label: "Connected",
    className: "bg-emerald-400/12 text-emerald-300 ring-emerald-400/20",
  },
  "needs-relink": {
    label: "Needs re-link",
    className: "bg-rose-400/12 text-rose-300 ring-rose-400/20",
  },
} as const

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")

// Admin copy is English-only (admin-surface.md): the admin is the solo operator,
// so the trilingual machinery that serves coaches never reaches these routes.
function AdminHome() {
  const { initData } = adminRoute.useLoaderData()
  const { data: workspaces } = useSuspenseQuery(adminWorkspaceListQuery(initData))
  const [search, setSearch] = useState("")
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

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-14 pb-10">
      <AdminHero />

      <label className="bg-card ring-border focus-within:ring-primary/60 mt-10 flex h-14 items-center gap-3 rounded-2xl px-4 ring-1 transition-shadow focus-within:ring-2">
        <HugeiconsIcon
          icon={Search01Icon}
          size={22}
          strokeWidth={1.8}
          className="text-muted-foreground"
        />
        <span className="sr-only">Search workspaces</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search"
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-base outline-none"
        />
      </label>

      <section className="mt-10" aria-labelledby="workspaces-heading">
        <h2 id="workspaces-heading" className="px-1 text-2xl font-semibold tracking-tight">
          Workspaces
        </h2>

        <div className="bg-card ring-border mt-4 overflow-hidden rounded-2xl ring-1">
          <button
            type="button"
            className="text-primary hover:bg-accent/40 active:bg-accent/70 flex min-h-[70px] w-full items-center gap-4 px-4 text-left font-medium transition-colors"
          >
            <span className="border-primary/50 flex size-11 items-center justify-center rounded-full border">
              <HugeiconsIcon icon={AddCircleIcon} size={25} strokeWidth={1.8} />
            </span>
            Create a workspace
          </button>

          {workspaces.length === 0 ? (
            <div className="border-border border-t px-6 py-10 text-center">
              <p className="font-medium">No workspaces yet</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Created workspaces will appear here.
              </p>
            </div>
          ) : filteredWorkspaces.length === 0 ? (
            <div className="border-border border-t px-6 py-10 text-center">
              <p className="font-medium">No workspaces match “{search.trim()}”</p>
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-primary mt-3 text-sm font-medium"
              >
                Clear search
              </button>
            </div>
          ) : (
            filteredWorkspaces.map((workspace) => {
              const status = statusPresentation[workspace.botStatus]
              return (
                <Link
                  key={workspace.id}
                  to="/admin/workspaces/$workspaceId"
                  params={{ workspaceId: workspace.id }}
                  className="border-border hover:bg-accent/40 active:bg-accent/70 flex min-h-[78px] items-center gap-4 border-t px-4 transition-colors"
                >
                  <span className="from-primary/85 flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br to-violet-950 text-sm font-semibold text-white">
                    {initials(workspace.name)}
                  </span>
                  <span className="min-w-0 flex-1 py-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">{workspace.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </span>
                    {workspace.botUsername ? (
                      <span className="text-muted-foreground mt-0.5 block truncate text-sm">
                        @{workspace.botUsername}
                      </span>
                    ) : null}
                  </span>
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={20}
                    strokeWidth={2}
                    className="text-muted-foreground/60 shrink-0"
                  />
                </Link>
              )
            })
          )}
        </div>
      </section>
    </main>
  )
}
