import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { HostFullscreen } from "@/mini-app.tsx"
import { SessionsScreen } from "@/features/coach/components/sessions-screen.tsx"
import { coachLaunch, orServerFailure } from "@/features/entry/coach-loader.ts"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { listSessions } from "@/server/coach-sessions.functions.ts"

/**
 * The sessions list (#61, both directions since #232): everything, grouped by
 * day. A drill-in from Today, left by the host's own back button — hub and
 * spoke, no tab bar (mini-app.md §Navigation model).
 *
 * Both views arrive in the one read: the segment switches between halves that
 * are already here rather than fetching, so a coach tapping Past learns
 * immediately whether there is anything behind them.
 */
export const Route = createFileRoute("/sessions/")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  loader: async () => {
    const [launch, sessions] = await Promise.all([coachLaunch(), orServerFailure(listSessions())])
    return { ...launch, sessions }
  },
  component: SessionsRoute,
})

function SessionsRoute() {
  const navigate = useNavigate()
  const { language, sessions } = Route.useLoaderData()
  const copy = coachCopy(language)
  // Read once per render of the screen rather than per row: every heading is
  // decided against the same instant, so a list cannot straddle midnight.
  const now = useMemo(() => new Date(), [])
  /**
   * Which half of the list is on show (#232).
   *
   * Local state and not a search parameter, unlike the booking flow's step
   * (#186): that one carried a draft a mis-swipe could destroy, while this
   * changes nothing and restores in one tap. Starting on Upcoming every time is
   * the point — a coach opening this screen is nearly always asking what
   * happens next, and the host's back control should leave the screen rather
   * than walk them back through views they have already read.
   */
  const [past, setPast] = useState(false)

  return (
    <MiniAppShell>
      <HostFullscreen />
      {sessions.ok ? (
        <SessionsScreen
          copy={copy}
          language={language}
          list={sessions.list}
          now={now}
          past={past}
          onView={setPast}
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
