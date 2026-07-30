import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { useCallback, useRef, useState } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { HostFullscreen } from "@/presentation-host"
import { ClientScreen } from "@/features/coach/components/client-screen.tsx"
import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { coachLaunch, orServerFailure } from "@/features/entry/coach-loader.ts"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { TimestampFormatProvider } from "@/features/mini-app/timestamp-format.tsx"
import { coachTimestampFormat } from "@/features/mini-app/coach-timestamp-format.ts"
import { impactHaptic, notifyHaptic, shareViaSystem } from "@/presentation-host"
import { acceptOnce } from "@/routes/index.tsx"
import { shareClientInvite } from "@/features/coach/invite-share.ts"
import { useCoachTimezone } from "@/features/coach/use-coach-timezone.ts"
import {
  deleteClient,
  getClient,
  recordInviteDelivery,
  sendInviteEmail,
  resetInvite,
} from "@/server/coach-clients.functions.ts"

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
    const [launch, detail] = await Promise.all([
      coachLaunch(),
      orServerFailure(getClient({ data: { clientId: params.clientId } })),
    ])
    return { ...launch, detail }
  },
  component: ClientRoute,
})

function ClientRoute() {
  const { entry, language, detail } = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const inFlight = useRef(false)

  // A coach can land here straight from the client-accepted push, without ever
  // passing through the home route.
  useCoachTimezone(entry.ok && entry.entry.kind === "home")
  const copy = coachCopy(language)
  const client = detail.ok ? detail.client : undefined

  const reset = useCallback(() => {
    if (client === undefined) return
    acceptOnce(inFlight, async () => {
      setPending(true)
      setError(undefined)
      try {
        const result = await resetInvite({ data: { clientId: client.id } })
        if (result.ok) {
          notifyHaptic("success")
          await router.invalidate()
          return
        }
        notifyHaptic("error")
        setError(copy.common.failed)
      } catch {
        notifyHaptic("error")
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
          notifyHaptic("success")
          await router.invalidate()
          await navigate({ to: "/clients" })
          return
        }
        notifyHaptic("error")
        setError(copy.common.failed)
      } catch {
        notifyHaptic("error")
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
   * Deliberately *not* one of the screen's `pending` operations, unlike every
   * other action here. This promise settles when Telegram's own callback fires,
   * which is a host we do not control: holding the busy flag across it would let
   * one silent client leave Schedule, Reissue and Delete disabled until the coach
   * relaunched. The picker is modal over the app anyway, so there is nothing the
   * busy state would have been protecting.
   *
   * A dismissed picker is silent: the invitation is untouched, and telling a
   * coach who just changed their mind that "nothing was sent" reads as a failure
   * they have to do something about. An invitation that turned out to be gone
   * re-reads the screen, which is what shows them why.
   *
   * A picker that *sent* re-reads it too, since #224: `shareClientInvite` has
   * just written the delivery down, and a screen still saying «Не отправлено»
   * about a card the coach watched leave would be the one lie this ticket
   * exists to remove.
   */
  const share = useCallback(() => {
    const invite = client?.invite
    if (client === undefined || invite === undefined) return
    setError(undefined)
    impactHaptic()
    void shareClientInvite({
      clientId: client.id,
      link: invite.telegram.url,
      message: invite.telegram.message,
    })
      .then(async (outcome) => {
        if (outcome === "gone") {
          notifyHaptic("warning")
          await router.invalidate()
        } else if (outcome === "failed") {
          notifyHaptic("error")
          setError(copy.common.failed)
        } else if (outcome === "shared" || outcome === "fallback") {
          await router.invalidate()
        }
      })
      .catch(() => {
        notifyHaptic("error")
        setError(copy.common.failed)
      })
  }, [client, copy, router])

  /**
   * The delivery, written down once it has actually happened (#224).
   *
   * Best-effort and silent: by the time this runs the invitation has left the
   * coach's phone, and a bookkeeping failure surfacing as an error would be the
   * screen contradicting something they just watched. The re-read is what turns
   * «Не отправлено» into «отправлено ссылкой», so it follows the write rather
   * than racing it.
   *
   * The Telegram door does not come through here — `shareClientInvite` records
   * it where it learns the picker's answer, so the resend on the Today screen
   * counts as the same event.
   */
  const delivered = useCallback(
    (kind: "telegram" | "link") => {
      if (client === undefined) return
      void recordInviteDelivery({ data: { clientId: client.id, kind } })
        .then(() => router.invalidate())
        .catch(() => undefined)
    },
    [client, router],
  )

  /**
   * The invitation the service sends itself (#58).
   *
   * A `pending` operation like Reissue and Delete, and unlike every share above
   * it: those hand something to a host we do not control and settle when that
   * host feels like it, while this one is our own round trip and the coach is
   * waiting for its answer. Holding the busy flag across it is what stops a
   * second tap becoming a second email.
   *
   * The three outcomes reach the coach as three sentences and nothing is
   * inferred from a thrown error: a transport failure is `unavailable` like any
   * other, because nothing was written either way and pressing again is safe.
   *
   * `gone` re-reads the screen rather than only complaining — the invitation
   * moved on underneath it, and what the coach needs next (the reissue control,
   * or an accepted client) is on the screen this fetches.
   */
  const sendEmail = useCallback(
    (address: string) => {
      if (client === undefined) return
      acceptOnce(inFlight, async () => {
        setPending(true)
        setError(undefined)
        try {
          const result = await sendInviteEmail({ data: { clientId: client.id, address } })
          if (!result.ok) {
            notifyHaptic("error")
            setError(copy.clients.emailUnavailable)
            return
          }
          if (result.outcome.sent) {
            notifyHaptic("success")
            await router.invalidate()
            return
          }
          notifyHaptic("error")
          if (result.outcome.reason === "invalid-address") {
            setError(copy.clients.emailInvalid)
          } else if (result.outcome.reason === "gone") {
            setError(copy.clients.emailGone)
            await router.invalidate()
          } else {
            setError(copy.clients.emailUnavailable)
          }
        } catch {
          notifyHaptic("error")
          setError(copy.clients.emailUnavailable)
        } finally {
          setPending(false)
        }
      })
    },
    [client, copy, router],
  )

  /**
   * The system share sheet, on iOS only — the screen decides whether to offer
   * it; this only has to tell a completed share from a cancelled one.
   *
   * A dismissed sheet is silent, exactly as a dismissed Telegram picker is: the
   * invitation is untouched and the coach simply changed their mind.
   */
  const shareSheet = useCallback(
    (message: string) => {
      impactHaptic()
      void shareViaSystem(message).then((outcome) => {
        if (outcome === "shared") delivered("link")
      })
    },
    [delivered],
  )

  if (client === undefined) {
    return (
      <MiniAppShell>
        <HostFullscreen />
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
      <HostFullscreen />
      <TimestampFormatProvider value={coachTimestampFormat(language)}>
        <ClientScreen
          copy={copy}
          language={language}
          client={client}
          // Scheduling is a route of its own (#186), entered with the client
          // already answered. `from` is what sends the booked session back
          // here rather than to the sessions list.
          onSchedule={() => {
            void navigate({
              to: "/sessions/new",
              search: { client: client.id, from: "client" },
            })
          }}
          onShare={share}
          onShareSheet={shareSheet}
          onDelivered={delivered}
          onSendEmail={sendEmail}
          onResetInvite={reset}
          onDelete={remove}
          pending={pending}
          error={error}
        />
      </TimestampFormatProvider>
    </MiniAppShell>
  )
}
