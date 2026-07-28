import { DefaultWorkingHours } from "@praximo/domain"
import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { WorkingHoursScreen } from "@/features/coach/components/working-hours-screen.tsx"
import { useWorkingHoursDraft } from "@/features/coach/use-working-hours.ts"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { HostFullscreen } from "@/presentation-host"
import { getWorkingHours } from "@/server/coach-clients.functions.ts"
import { loadCoachEntry } from "@/server/coach.functions.ts"

/** The shared window and the seven days that follow it (#210). */
export const Route = createFileRoute("/availability/hours")({
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
  component: WorkingHoursRoute,
})

function WorkingHoursRoute() {
  const { entry, hours, launchLanguage } = Route.useLoaderData()
  const navigate = useNavigate()

  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
  const copy = coachCopy(language)
  const draft = useWorkingHoursDraft(
    hours.ok ? hours.hours : DefaultWorkingHours,
    copy.availability.saveFailed,
  )

  return (
    <MiniAppShell>
      <HostFullscreen />
      <WorkingHoursScreen
        copy={copy.availability}
        common={copy.common}
        language={language}
        hours={draft.hours}
        onChange={draft.commit}
        onPerDay={() => void navigate({ to: "/availability/hours/days" })}
        error={draft.error}
      />
    </MiniAppShell>
  )
}
