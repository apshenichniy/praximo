import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { SessionsScreen } from "@/features/coach/components/sessions-screen.tsx"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { listUpcomingSessions } from "@/server/coach-sessions.functions.ts"
import { loadCoachEntry } from "@/server/coach.functions.ts"

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
    const [entry, upcoming, credential] = await Promise.all([
      loadCoachEntry().catch(() => ({ ok: false, error: "server" }) as const),
      listUpcomingSessions().catch(() => ({ ok: false, error: "server" }) as const),
      resolveLaunchCredential(),
    ])
    return { entry, upcoming, launchLanguage: launchLocale(credential.initData) }
  },
  component: SessionsRoute,
})

function SessionsRoute() {
  const { entry, upcoming, launchLanguage } = Route.useLoaderData()
  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
  const copy = coachCopy(language)
  // Read once per render of the screen rather than per row: every heading is
  // decided against the same instant, so a list cannot straddle midnight.
  const now = useMemo(() => new Date(), [])

  return (
    <MiniAppShell>
      <TelegramFullscreen />
      {upcoming.ok ? (
        <SessionsScreen copy={copy} language={language} upcoming={upcoming.upcoming} now={now} />
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
