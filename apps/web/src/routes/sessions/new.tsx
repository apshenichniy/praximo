import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { ClientPickerScreen } from "@/features/coach/components/client-picker-screen.tsx"
import {
  daySchedule,
  dayScheduleKeys,
  primeDayRange,
  UnknownDaySchedule,
} from "@/features/coach/day-schedule-queries.ts"
import { bookedDates } from "@/features/coach/session-days.ts"
import {
  calendarDate,
  type SchedulingDraft,
  SchedulingScreen,
} from "@/features/coach/components/scheduling-screen.tsx"
import { validateSchedulingSearch } from "@/features/coach/scheduling-search.ts"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { coachTimestampFormat } from "@/features/mini-app/coach-timestamp-format.ts"
import { TimestampFormatProvider } from "@/features/mini-app/timestamp-format.tsx"
import { acceptOnce } from "@/routes/index.tsx"
import type { CoachClients } from "@/server/coach-clients.ts"
import { getClient, listClients, scheduleSession } from "@/server/coach-clients.functions.ts"
import { loadCoachEntry } from "@/server/coach.functions.ts"

/**
 * The whole booking, on one route (#61, routed in #186).
 *
 * Two steps, told apart by the `client` search parameter: **pick the client**,
 * then **schedule**. From the client route the first step is already answered,
 * so that entrance links straight past it — same route, same screen, no second
 * copy of the form that could drift from this one.
 *
 * The step being a URL is the point. The sheet this replaced was local state,
 * which left Telegram's BackButton and a swipe down disagreeing about what
 * "back" meant, and made a mis-swipe cost the whole draft.
 */
export const Route = createFileRoute("/sessions/new")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  validateSearch: validateSchedulingSearch,
  loader: async () => {
    const [entry, clients, credential] = await Promise.all([
      loadCoachEntry().catch(() => ({ ok: false, error: "server" }) as const),
      listClients().catch(() => ({ ok: false, error: "server" }) as const),
      resolveLaunchCredential(),
    ])
    return { entry, clients, launchLanguage: launchLocale(credential.initData) }
  },
  component: NewSessionRoute,
})

function NewSessionRoute() {
  const { entry, clients, launchLanguage } = Route.useLoaderData()
  const { client: clientId, from } = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [chosen, setChosen] = useState<CoachClients.ClientDetail>()
  const [unreadable, setUnreadable] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [date, setDate] = useState(() => calendarDate(new Date()))
  const inFlight = useRef(false)

  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
  const copy = coachCopy(language)

  /**
   * The chosen client, read in full whenever the URL names one.
   *
   * The screen needs their name for its footnote and their existing sessions for
   * the dots on the month — and the client route already loads exactly this, so
   * both entrances draw the same calendar from the same read rather than from
   * two different summaries of it. Reading it here rather than carrying it from
   * the tap is what makes the link openable at all: a coach can arrive on this
   * URL from history, from a reload, or from the client route.
   */
  useEffect(() => {
    setChosen(undefined)
    setUnreadable(false)
    if (clientId === undefined) return
    let cancelled = false
    setDate(calendarDate(new Date()))
    void getClient({ data: { clientId } })
      .then((result) => {
        if (cancelled) return
        if (result.ok && result.client !== undefined) setChosen(result.client)
        else setUnreadable(true)
      })
      .catch(() => {
        if (!cancelled) setUnreadable(true)
      })
    return () => {
      cancelled = true
    }
  }, [clientId])

  /**
   * The day the screen is looking at. The grid is drawn from the coach's own
   * bookings, so it cannot be computed in the browser alone — and the screen
   * must never offer a slot the server refuses.
   *
   * Cached per date, so comparing two days costs one read each rather than one
   * per glance. A day that will not load reads as an empty one, which is what
   * the screen did before the cache — but only after the retries, so a blink of
   * network trouble no longer looks like a full day.
   */
  const dayQuery = useQuery({ ...daySchedule(date), enabled: chosen !== undefined })
  const day = dayQuery.data ?? (dayQuery.isError ? UnknownDaySchedule : undefined)

  /**
   * The strip's whole window, read in one request and filed per day.
   *
   * A day is a handful of intervals, so a fortnight of them is a couple of
   * kilobytes — the cost of a day-at-a-time strip is the fourteen round-trips,
   * not the bytes. Asked for as soon as the strip says what it is showing, so
   * walking along it is answered from memory rather than from Neon.
   */
  const readDays = useCallback(
    (start: string, days: number) => {
      void primeDayRange(queryClient, start, days)
    },
    [queryClient],
  )

  const pick = useCallback(
    (picked: string) => {
      void navigate({ to: "/sessions/new", search: { client: picked } })
    },
    [navigate],
  )

  const schedule = useCallback(
    (draft: SchedulingDraft) => {
      if (chosen === undefined) return
      acceptOnce(inFlight, async () => {
        setPending(true)
        setError(undefined)
        try {
          const result = await scheduleSession({
            data: {
              clientId: chosen.id,
              date: draft.date,
              startMinutes: draft.startMinutes,
              durationMinutes: draft.durationMinutes,
              kind: draft.kind,
            },
          })
          if (result.ok && result.outcome.scheduled) {
            // Every cached day, not just this one: a booking is exactly the
            // event that makes a remembered free slot a lie, and the next screen
            // to ask for a day must ask the server.
            await queryClient.invalidateQueries({ queryKey: dayScheduleKeys.all })
            // The list is the proof: a toast cannot be checked afterwards, and
            // the session the coach just booked is the first thing on it. A
            // booking that began on a client goes back to that client instead —
            // their own sessions section is the same proof, and it is where the
            // coach was.
            await router.invalidate()
            await (from === "client"
              ? navigate({
                  to: "/clients/$clientId",
                  params: { clientId: chosen.id },
                  replace: true,
                })
              : navigate({ to: "/sessions", replace: true }))
            return
          }
          const reason = result.ok && !result.outcome.scheduled ? result.outcome.reason : "failed"
          setError(
            reason === "overlap"
              ? copy.clients.overlapError
              : reason === "past"
                ? copy.clients.pastError
                : reason === "invalid"
                  ? copy.clients.invalidError
                  : copy.common.failed,
          )
        } catch {
          setError(copy.common.failed)
        } finally {
          setPending(false)
        }
      })
    },
    [chosen, copy, from, navigate, router],
  )

  if (!clients.ok) {
    return (
      <MiniAppShell>
        <TelegramFullscreen />
        <EntryFrame
          icon={WifiDisconnected01Icon}
          tone="muted"
          title={copy.entry.unavailableTitle}
          body={copy.entry.unavailableBody}
        />
      </MiniAppShell>
    )
  }

  // A named client who cannot be read is a dead end rather than a slow one: the
  // picker underneath would offer to start the booking the URL says is already
  // under way.
  if (unreadable) {
    return (
      <MiniAppShell>
        <TelegramFullscreen />
        <EntryFrame
          icon={WifiDisconnected01Icon}
          tone="muted"
          title={copy.entry.unavailableTitle}
          body={copy.entry.unavailableBody}
        />
      </MiniAppShell>
    )
  }

  if (clientId !== undefined && chosen === undefined) return <EntryLoading />

  return (
    <MiniAppShell>
      <TelegramFullscreen />
      <TimestampFormatProvider value={coachTimestampFormat(language)}>
        {chosen === undefined ? (
          <ClientPickerScreen copy={copy} clients={clients.home.clients} onPick={pick} />
        ) : (
          <SchedulingScreen
            // Keyed on the client so a second booking starts clean: every field
            // the screen owns is initialised at mount.
            key={chosen.id}
            copy={copy.clients}
            backLabel={copy.common.back}
            language={language}
            clientName={chosen.name}
            firstSession={chosen.sessions.length === 0}
            bookedDates={bookedDates(chosen)}
            schedule={day}
            onDateChange={setDate}
            onDaysVisible={readDays}
            onSubmit={schedule}
            pending={pending}
            error={error}
          />
        )}
      </TimestampFormatProvider>
    </MiniAppShell>
  )
}
