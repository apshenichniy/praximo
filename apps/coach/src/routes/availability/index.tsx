import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { useCallback } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { AvailabilityScreen } from "@/features/coach/components/availability-screen.tsx"
import { HoursUnavailable } from "@/features/entry/components/hours-unavailable.tsx"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { HostFullscreen } from "@/presentation-host"
import { getWorkingHours } from "@/server/coach-clients.functions.ts"
import { loadCoachEntry } from "@/server/coach.functions.ts"

/**
 * Availability (#210) — the screen the navigation model did not have, and the
 * one the calendar slice needs a home on.
 *
 * The loader asks for the entry and the hours together: the entry carries the
 * language every screen renders in, and the hours are the screen itself.
 */
export const Route = createFileRoute("/availability/")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  loader: async () => {
    const [entry, hours, credential] = await Promise.all([
      loadCoachEntry().catch(() => ({ ok: false, error: "server" }) as const),
      getWorkingHours().catch(() => ({ ok: false, error: "server" }) as const),
      resolveLaunchCredential(),
    ])
    return { entry, hours, launchLanguage: launchLocale(credential.initData) }
  },
  component: AvailabilityRoute,
})

function AvailabilityRoute() {
  const { entry, hours, launchLanguage } = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const retry = useCallback(() => void router.invalidate(), [router])

  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
  const copy = coachCopy(language)

  if (!hours.ok) {
    return (
      <MiniAppShell>
        <HostFullscreen />
        <HoursUnavailable copy={copy} onRetry={retry} />
      </MiniAppShell>
    )
  }

  return (
    <MiniAppShell>
      <HostFullscreen />
      <AvailabilityScreen
        copy={copy.availability}
        common={copy.common}
        language={language}
        hours={hours.hours}
        onWorkingHours={() => void navigate({ to: "/availability/hours" })}
      />
    </MiniAppShell>
  )
}
