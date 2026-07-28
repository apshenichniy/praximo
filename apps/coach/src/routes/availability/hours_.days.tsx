import { DefaultWorkingHours } from "@praximo/domain"
import { createFileRoute } from "@tanstack/react-router"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { WorkingHoursDaysScreen } from "@/features/coach/components/working-hours-days-screen.tsx"
import { useWorkingHoursDraft } from "@/features/coach/use-working-hours.ts"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { HostFullscreen } from "@/presentation-host"
import { getWorkingHours } from "@/server/coach-clients.functions.ts"
import { loadCoachEntry } from "@/server/coach.functions.ts"

/**
 * The seven entries, one row each — the escape hatch from the shared window.
 *
 * Its own route rather than a fold on the screen before it: a picker inside a
 * list of seven rows wants more height than the phone has, and the row that
 * would follow it lands off the bottom edge exactly when it is needed.
 */
export const Route = createFileRoute("/availability/hours_/days")({
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
  component: WorkingHoursDaysRoute,
})

function WorkingHoursDaysRoute() {
  const { entry, hours, launchLanguage } = Route.useLoaderData()

  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
  const copy = coachCopy(language)
  const draft = useWorkingHoursDraft(
    hours.ok ? hours.hours : DefaultWorkingHours,
    copy.availability.saveFailed,
  )

  return (
    <MiniAppShell>
      <HostFullscreen />
      <WorkingHoursDaysScreen
        copy={copy.availability}
        common={copy.common}
        language={language}
        hours={draft.hours}
        onChange={draft.commit}
        error={draft.error}
      />
    </MiniAppShell>
  )
}
