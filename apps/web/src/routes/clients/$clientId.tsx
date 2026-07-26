import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { ClientScreen } from "@/features/coach/components/client-screen.tsx"
import {
  calendarDate,
  type DayScheduleData,
  type SchedulingDraft,
  SchedulingSheet,
} from "@/features/coach/components/scheduling-sheet.tsx"
import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { TimestampFormatProvider } from "@/features/mini-app/timestamp-format.tsx"
import { coachTimestampFormat } from "@/features/mini-app/coach-timestamp-format.ts"
import { acceptOnce } from "@/routes/index.tsx"
import { shareClientInvite } from "@/features/coach/invite-share.ts"
import { useCoachTimezone } from "@/features/coach/use-coach-timezone.ts"
import {
  deleteClient,
  getClient,
  getDaySchedule,
  resetInvite,
  scheduleSession,
} from "@/server/coach-clients.functions.ts"
import { loadCoachEntry } from "@/server/coach.functions.ts"

/**
 * One client's route (#56 §Client route). Identical immediately after creation
 * and on return a day later — there is no separate success screen, because the
 * difference between those two moments is nothing.
 */
export const Route = createFileRoute("/clients/$clientId")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  loader: async ({ params }) => {
    const [entry, detail, credential] = await Promise.all([
      loadCoachEntry().catch(() => ({ ok: false, error: "server" }) as const),
      getClient({ data: { clientId: params.clientId } }).catch(
        () => ({ ok: false, error: "server" }) as const,
      ),
      resolveLaunchCredential(),
    ])
    return { entry, detail, launchLanguage: launchLocale(credential.initData) }
  },
  component: ClientRoute,
})

function ClientRoute() {
  const { entry, detail, launchLanguage } = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [day, setDay] = useState<DayScheduleData>()
  const [date, setDate] = useState(() => calendarDate(new Date()))
  const inFlight = useRef(false)

  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
  // A coach can land here straight from the client-accepted push, without ever
  // passing through the home route.
  useCoachTimezone(entry.ok && entry.entry.kind === "home")
  const copy = coachCopy(language)
  const client = detail.ok ? detail.client : undefined

  /**
   * The day the sheet is looking at, loaded whenever it changes. The grid is
   * drawn from the coach's own bookings, so it cannot be computed in the
   * browser alone — and the sheet must never offer a slot the server refuses.
   */
  useEffect(() => {
    if (!sheetOpen) return
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
  }, [date, sheetOpen])

  const schedule = useCallback(
    (draft: SchedulingDraft) => {
      if (client === undefined) return
      acceptOnce(inFlight, async () => {
        setPending(true)
        setError(undefined)
        try {
          const result = await scheduleSession({
            data: {
              clientId: client.id,
              date: draft.date,
              startMinutes: draft.startMinutes,
              durationMinutes: draft.durationMinutes,
              kind: draft.kind,
            },
          })
          if (result.ok && result.outcome.scheduled) {
            setSheetOpen(false)
            // The sessions section is the proof the scheduling worked: a toast
            // cannot be checked afterwards, so the list is re-read.
            await router.invalidate()
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
    [client, copy, router],
  )

  const reset = useCallback(() => {
    if (client === undefined) return
    acceptOnce(inFlight, async () => {
      setPending(true)
      setError(undefined)
      try {
        const result = await resetInvite({ data: { clientId: client.id } })
        if (result.ok) {
          await router.invalidate()
          return
        }
        setError(copy.common.failed)
      } catch {
        setError(copy.common.failed)
      } finally {
        setPending(false)
      }
    })
  }, [client, copy, router])

  const remove = useCallback(() => {
    if (client === undefined) return
    acceptOnce(inFlight, async () => {
      setPending(true)
      setError(undefined)
      try {
        const result = await deleteClient({ data: { clientId: client.id } })
        if (result.ok && result.deleted) {
          await router.invalidate()
          await navigate({ to: "/" })
          return
        }
        setError(copy.common.failed)
      } catch {
        setError(copy.common.failed)
      } finally {
        setPending(false)
      }
    })
  }, [client, copy, navigate, router])

  /**
   * The card is minted on this tap and shared through Telegram's own picker
   * (#179).
   *
   * A dismissed picker is deliberately silent: the invitation is untouched, and
   * telling a coach who just changed their mind that "nothing was sent" reads as
   * a failure they have to do something about. An invitation that turned out to
   * be gone re-reads the screen, which is what shows them why.
   */
  const share = useCallback(() => {
    const invite = client?.invite
    if (client === undefined || invite === undefined) return
    acceptOnce(inFlight, async () => {
      setPending(true)
      setError(undefined)
      try {
        const outcome = await shareClientInvite({
          clientId: client.id,
          link: invite.url,
          name: client.name,
          lead: copy.clients.invitationLeadTail,
        })
        if (outcome === "gone") {
          await router.invalidate()
          return
        }
        if (outcome === "failed") setError(copy.common.failed)
      } catch {
        setError(copy.common.failed)
      } finally {
        setPending(false)
      }
    })
  }, [client, copy, router])

  if (client === undefined) {
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
        <ClientScreen
          copy={copy}
          language={language}
          client={client}
          onBack={() => void navigate({ to: "/" })}
          onSchedule={() => {
            setError(undefined)
            setDate(calendarDate(new Date()))
            setSheetOpen(true)
          }}
          onShare={share}
          onResetInvite={reset}
          onDelete={remove}
          pending={pending}
          error={error}
        />
        <SchedulingSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          copy={copy.clients}
          language={language}
          clientName={client.name}
          firstSession={client.sessions.length === 0}
          schedule={day}
          onDateChange={setDate}
          onSubmit={schedule}
          pending={pending}
          error={error}
        />
      </TimestampFormatProvider>
    </MiniAppShell>
  )
}
