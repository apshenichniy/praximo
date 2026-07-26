import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { ClientPickerScreen } from "@/features/coach/components/client-picker-screen.tsx"
import { bookedDates } from "@/features/coach/session-days.ts"
import {
  calendarDate,
  type DayScheduleData,
  type SchedulingDraft,
  SchedulingSheet,
} from "@/features/coach/components/scheduling-sheet.tsx"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { coachTimestampFormat } from "@/features/mini-app/coach-timestamp-format.ts"
import { TimestampFormatProvider } from "@/features/mini-app/timestamp-format.tsx"
import { acceptOnce } from "@/routes/index.tsx"
import type { CoachClients } from "@/server/coach-clients.ts"
import {
  getClient,
  getDaySchedule,
  listClients,
  scheduleSession,
} from "@/server/coach-clients.functions.ts"
import { loadCoachEntry } from "@/server/coach.functions.ts"

/**
 * New session, started from Today (#61).
 *
 * One step precedes #56's sheet — **pick the client** — because from the
 * dashboard the coach has nobody in hand. From the client route that step does
 * not exist, and the sheet itself is the same component either way, so duration
 * and kind cannot drift apart between the two entrances.
 */
export const Route = createFileRoute("/sessions/new")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
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
  const navigate = useNavigate()
  const router = useRouter()
  const [chosen, setChosen] = useState<CoachClients.ClientDetail>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [day, setDay] = useState<DayScheduleData>()
  const [date, setDate] = useState(() => calendarDate(new Date()))
  const inFlight = useRef(false)

  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
  const copy = coachCopy(language)

  /**
   * The chosen client, read in full before the sheet opens.
   *
   * The sheet needs their name for its footnote and their existing sessions for
   * the dots on the month — and the client route already loads exactly this, so
   * both entrances draw the same calendar from the same read rather than from
   * two different summaries of it.
   */
  const pick = useCallback(
    (clientId: string) => {
      acceptOnce(inFlight, async () => {
        setPending(true)
        setError(undefined)
        try {
          const result = await getClient({ data: { clientId } })
          if (result.ok && result.client !== undefined) {
            setDate(calendarDate(new Date()))
            setChosen(result.client)
            return
          }
          setError(copy.common.failed)
        } catch {
          setError(copy.common.failed)
        } finally {
          setPending(false)
        }
      })
    },
    [copy],
  )

  /**
   * The day the sheet is looking at, loaded whenever it changes. The grid is
   * drawn from the coach's own bookings, so it cannot be computed in the browser
   * alone — and the sheet must never offer a slot the server refuses.
   */
  useEffect(() => {
    if (chosen === undefined) return
    let cancelled = false
    setDay(undefined)
    void getDaySchedule({ data: { date } })
      .then((result) => {
        if (cancelled) return
        setDay(result.ok ? result.day : { busy: [], timezone: "UTC" })
      })
      .catch(() => {
        if (!cancelled) setDay({ busy: [], timezone: "UTC" })
      })
    return () => {
      cancelled = true
    }
  }, [chosen, date])

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
            // The list is the proof: a toast cannot be checked afterwards, and
            // the session the coach just booked is the first thing on it.
            await router.invalidate()
            await navigate({ to: "/sessions" })
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
    [chosen, copy, navigate, router],
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

  return (
    <MiniAppShell>
      <TelegramFullscreen />
      <TimestampFormatProvider value={coachTimestampFormat(language)}>
        <ClientPickerScreen copy={copy} clients={clients.home.clients} onPick={pick} />
        {chosen === undefined ? null : (
          <SchedulingSheet
            open
            onOpenChange={(open) => {
              if (!open) setChosen(undefined)
            }}
            copy={copy.clients}
            language={language}
            clientName={chosen.name}
            firstSession={chosen.sessions.length === 0}
            bookedDates={bookedDates(chosen)}
            schedule={day}
            onDateChange={setDate}
            onSubmit={schedule}
            pending={pending}
            error={error}
          />
        )}
      </TimestampFormatProvider>
    </MiniAppShell>
  )
}
