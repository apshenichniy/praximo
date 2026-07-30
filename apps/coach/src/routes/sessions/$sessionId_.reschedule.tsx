import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { useCallback, useMemo, useRef, useState } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { HostFullscreen, notifyHaptic } from "@/mini-app.tsx"
import {
  daySchedule,
  dayScheduleKeys,
  primeDayRange,
  UnknownDaySchedule,
} from "@/features/coach/day-schedule-queries.ts"
import { ownSlot, reschedulePrefill, withoutOwnSlot } from "@/features/coach/reschedule.ts"
import {
  calendarDate,
  type SchedulingDraft,
  SchedulingScreen,
} from "@/features/coach/components/scheduling-screen.tsx"
import { coachLaunch, orServerFailure } from "@/features/entry/coach-loader.ts"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { localParts } from "@/lib/coach-calendar.ts"
import { acceptOnce } from "@/routes/index.tsx"
import { getClient } from "@/server/coach-clients.functions.ts"
import { getSession, rescheduleSession } from "@/server/coach-sessions.functions.ts"

/**
 * Moving a session that already exists (#62).
 *
 * A route of its own rather than a mode on `/sessions/new`: a URL saying «new»
 * while it moves an existing session is a lie, and the two differ in what they
 * open on, in what they submit, and in what counts as busy. What they share is
 * the whole screen — so a duration chip cannot mean one thing here and another
 * there.
 *
 * Entered only from the session screen, so there is no `from` parameter to carry
 * an origin: back goes to the session, and a successful move replaces onto it,
 * where the new time is already on the page.
 */
export const Route = createFileRoute("/sessions/$sessionId_/reschedule")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  loader: async ({ params }) => {
    const [launch, detail] = await Promise.all([
      coachLaunch(),
      orServerFailure(getSession({ data: { sessionId: params.sessionId } })),
    ])
    // The client is read second because only the session names them. It is here
    // for the month's dots — the days this client already carries — which is the
    // same read `/sessions/new` makes for the same reason.
    const session = detail.ok ? detail.session : undefined
    const client =
      session === undefined
        ? undefined
        : await orServerFailure(getClient({ data: { clientId: session.clientId } }))
    return { ...launch, detail, client }
  },
  component: RescheduleRoute,
})

function RescheduleRoute() {
  const { language, detail, client } = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const inFlight = useRef(false)
  const copy = coachCopy(language)

  const session = detail.ok ? detail.session : undefined
  /**
   * A session that cannot be moved is not a screen to be on. Terminal and
   * running states are refused by the statement anyway; catching them here means
   * the coach meets a sentence rather than a form that cannot submit.
   */
  const movable = session !== undefined && session.state === "scheduled"

  const own = useMemo(() => (movable && session ? ownSlot(session) : undefined), [movable, session])
  const opening = useMemo(
    () =>
      own === undefined || session === undefined
        ? undefined
        : reschedulePrefill(own, localParts(new Date(), session.timezone).date),
    [own, session],
  )

  const [date, setDate] = useState(() => opening?.date ?? calendarDate(new Date()))

  const dayQuery = useQuery({ ...daySchedule(date), enabled: own !== undefined })
  const day = dayQuery.data ?? (dayQuery.isError ? UnknownDaySchedule : undefined)
  /**
   * The day the coach picks from, minus the session's own hour. Without this the
   * screen would draw the slot it is standing on as taken and refuse to re-offer
   * a time the server would have accepted.
   */
  const schedule = useMemo(
    () =>
      day === undefined || own === undefined
        ? day
        : { ...day, busy: withoutOwnSlot(day.busy, own, date) },
    [date, day, own],
  )

  const readDays = useCallback(
    (start: string, days: number) => {
      void primeDayRange(queryClient, start, days)
    },
    [queryClient],
  )

  /**
   * The month's dots are this client's *other* days: the one being moved is not
   * a day they are booked on any more.
   */
  const bookedDates = useMemo(() => {
    if (client === undefined || !client.ok || client.client === undefined) return []
    const timezone = client.client.timezone
    return client.client.sessions
      .filter((entry) => entry.id !== session?.id)
      .map((entry) => localParts(new Date(entry.scheduledAt), timezone).date)
  }, [client, session])

  const move = useCallback(
    (draft: SchedulingDraft) => {
      if (session === undefined) return
      acceptOnce(inFlight, async () => {
        setPending(true)
        setError(undefined)
        try {
          const result = await rescheduleSession({ data: { sessionId: session.id, ...draft } })
          if (result.ok && result.outcome.rescheduled) {
            notifyHaptic("success")
            // Every cached day: a move frees one slot and takes another, so a
            // remembered free minute anywhere is now a guess.
            await queryClient.invalidateQueries({ queryKey: dayScheduleKeys.all })
            await router.invalidate()
            await navigate({
              to: "/sessions/$sessionId",
              params: { sessionId: session.id },
              replace: true,
            })
            return
          }
          notifyHaptic("error")
          const reason = result.ok && !result.outcome.rescheduled ? result.outcome.reason : "failed"
          if (reason === "gone") {
            // The session moved on underneath the coach. The screen that says so
            // is the one this came from, and it is a re-read away.
            setError(copy.sessions.notFound)
            await router.invalidate()
            return
          }
          setError(
            reason === "overlap"
              ? copy.sessions.rescheduleOverlap
              : reason === "past"
                ? copy.clients.pastError
                : reason === "invalid"
                  ? copy.clients.invalidError
                  : copy.common.failed,
          )
        } catch {
          notifyHaptic("error")
          setError(copy.common.failed)
        } finally {
          setPending(false)
        }
      })
    },
    [copy, navigate, queryClient, router, session],
  )

  if (session === undefined || opening === undefined || !movable) {
    return (
      <MiniAppShell>
        <HostFullscreen />
        <EntryFrame
          icon={WifiDisconnected01Icon}
          tone="muted"
          title={copy.entry.unavailableTitle}
          body={detail.ok ? copy.sessions.notFound : copy.entry.unavailableBody}
        />
      </MiniAppShell>
    )
  }

  return (
    <MiniAppShell>
      <HostFullscreen />
      <SchedulingScreen
        copy={copy.clients}
        backLabel={copy.common.back}
        language={language}
        clientName={session.clientName}
        purpose={{ kind: "reschedule", from: opening, onSubmit: move }}
        bookedDates={bookedDates}
        schedule={schedule}
        onDateChange={setDate}
        onDaysVisible={readDays}
        pending={pending}
        error={error}
      />
    </MiniAppShell>
  )
}
