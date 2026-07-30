import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useCallback, useRef, useState } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { HostFullscreen, notifyHaptic } from "@/mini-app.tsx"
import { SessionScreen } from "@/features/coach/components/session-screen.tsx"
import { coachLaunch, orServerFailure } from "@/features/entry/coach-loader.ts"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { acceptOnce } from "@/routes/index.tsx"
import { cancelSession, getSession } from "@/server/coach-sessions.functions.ts"

/**
 * One session, and the two things a coach can do to it (#62). #61 shipped this
 * as a deliberate stub — the facts and no actions — so the list rows and Today's
 * cards led somewhere complete-looking until this ticket.
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
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const inFlight = useRef(false)
  const copy = coachCopy(language)
  const session = detail.ok ? detail.session : undefined

  /**
   * The cancellation, and then **this same screen** rather than a list.
   *
   * A cancelled session leaves Today and the sessions list immediately — both
   * filter to the states that hold a slot — so a coach sent back to a list would
   * be sent to the one place the write is invisible. Re-reading here is the only
   * proof available, and it is the honest one: the session still exists, as a
   * record, and now says so.
   *
   * This is where it differs from deleting a client, which does navigate away —
   * there the object is gone.
   */
  const cancel = useCallback(() => {
    if (session === undefined) return
    acceptOnce(inFlight, async () => {
      setPending(true)
      setError(undefined)
      try {
        const result = await cancelSession({ data: { sessionId: session.id } })
        if (result.ok && result.cancelled) {
          notifyHaptic("success")
          await router.invalidate()
          return
        }
        notifyHaptic("error")
        // A refusal means the session was no longer this coach's to cancel —
        // already cancelled, or running. The re-read is what shows them which.
        setError(result.ok ? copy.sessions.notFound : copy.common.failed)
        if (result.ok) await router.invalidate()
      } catch {
        notifyHaptic("error")
        setError(copy.common.failed)
      } finally {
        setPending(false)
      }
    })
  }, [copy, router, session])

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
        <SessionScreen
          copy={copy}
          language={language}
          session={session}
          onCancel={cancel}
          pending={pending}
          error={error}
        />
      )}
    </MiniAppShell>
  )
}
