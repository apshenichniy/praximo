import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { useCallback } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { WorkingHoursScreen } from "@/features/coach/components/working-hours-screen.tsx"
import { coachLaunch, orServerFailure } from "@/features/entry/coach-loader.ts"
import { HoursUnavailable } from "@/features/entry/components/hours-unavailable.tsx"
import { useWorkingHoursDraft } from "@/features/coach/use-working-hours.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { HostFullscreen } from "@/mini-app.tsx"
import { getWorkingHours } from "@/server/coach-clients.functions.ts"

/** The shared window and the seven days that follow it (#210). */
export const Route = createFileRoute("/availability/hours")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  loader: async () => {
    const [launch, hours] = await Promise.all([coachLaunch(), orServerFailure(getWorkingHours())])
    return { ...launch, hours }
  },
  component: WorkingHoursRoute,
})

function WorkingHoursRoute() {
  const { language, hours } = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const retry = useCallback(() => void router.invalidate(), [router])

  const copy = coachCopy(language)
  // The screen commits on change, so it may only ever open on a week that was
  // actually read. Seeding it with the default would arm every control on it
  // against hours the coach really has.
  const draft = useWorkingHoursDraft(
    hours.ok ? hours.hours : undefined,
    copy.availability.saveFailed,
  )

  if (!hours.ok || draft === undefined) {
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
