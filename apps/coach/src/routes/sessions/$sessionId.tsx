import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { createFileRoute } from "@tanstack/react-router"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { HostFullscreen } from "@/presentation-host"
import { SessionScreen } from "@/features/coach/components/session-screen.tsx"
import { coachLaunch, orServerFailure } from "@/features/entry/coach-loader.ts"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { getSession } from "@/server/coach-sessions.functions.ts"

/**
 * One session — a **stub** in this ticket (#61), so that the list rows and
 * Today's cards lead somewhere complete-looking. #62 is the named creditor: it
 * develops this into the real screen with reschedule, cancel and the artifacts.
 */
export const Route = createFileRoute("/sessions/$sessionId")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  loader: async ({ params }) => {
    const [launch, detail] = await Promise.all([
      coachLaunch(),
      orServerFailure(getSession({ data: { sessionId: params.sessionId } })),
    ])
    return { ...launch, detail }
  },
  component: SessionRoute,
})

function SessionRoute() {
  const { language, detail } = Route.useLoaderData()
  const copy = coachCopy(language)
  const session = detail.ok ? detail.session : undefined

  return (
    <MiniAppShell>
      <HostFullscreen />
      {session === undefined ? (
        <EntryFrame
          icon={WifiDisconnected01Icon}
          tone="muted"
          title={copy.entry.unavailableTitle}
          body={detail.ok ? copy.sessions.notFound : copy.entry.unavailableBody}
        />
      ) : (
        <SessionScreen copy={copy} language={language} session={session} />
      )}
    </MiniAppShell>
  )
}
