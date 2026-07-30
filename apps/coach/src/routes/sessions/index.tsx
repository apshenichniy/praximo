import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { HostFullscreen } from "@/mini-app.tsx"
import { SessionsScreen } from "@/features/coach/components/sessions-screen.tsx"
import { coachLaunch, orServerFailure } from "@/features/entry/coach-loader.ts"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { listUpcomingSessions } from "@/server/coach-sessions.functions.ts"

/**
 * The sessions list (#61): everything ahead, grouped by day. A drill-in from
 * Today, left by the host's own back button — hub and spoke, no tab bar
 * (mini-app.md §Navigation model).
 */
export const Route = createFileRoute("/sessions/")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  loader: async () => {
    const [launch, upcoming] = await Promise.all([
      coachLaunch(),
      orServerFailure(listUpcomingSessions()),
    ])
    return { ...launch, upcoming }
  },
  component: SessionsRoute,
})

function SessionsRoute() {
  const navigate = useNavigate()
  const { language, upcoming } = Route.useLoaderData()
  const copy = coachCopy(language)
  // Read once per render of the screen rather than per row: every heading is
  // decided against the same instant, so a list cannot straddle midnight.
  const now = useMemo(() => new Date(), [])

  return (
    <MiniAppShell>
      <HostFullscreen />
      {upcoming.ok ? (
        <SessionsScreen
          copy={copy}
          language={language}
          upcoming={upcoming.upcoming}
          now={now}
          onCreate={() => void navigate({ to: "/sessions/new" })}
        />
      ) : (
        <EntryFrame
          icon={WifiDisconnected01Icon}
          tone="muted"
          title={copy.entry.unavailableTitle}
          body={copy.entry.unavailableBody}
        />
      )}
    </MiniAppShell>
  )
}
