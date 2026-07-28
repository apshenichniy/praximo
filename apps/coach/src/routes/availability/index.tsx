import { DefaultWorkingHours } from "@praximo/domain"
import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { AvailabilityScreen } from "@/features/coach/components/availability-screen.tsx"
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

  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
  const copy = coachCopy(language)

  return (
    <MiniAppShell>
      <HostFullscreen />
      <AvailabilityScreen
        copy={copy.availability}
        common={copy.common}
        language={language}
        // The default is a real schedule the sheet is already using, so a read
        // that failed shows the hours every coach starts with rather than a
        // blank the screen would have to explain.
        hours={hours.ok ? hours.hours : DefaultWorkingHours}
        onWorkingHours={() => void navigate({ to: "/availability/hours" })}
      />
    </MiniAppShell>
  )
}
