import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { useCallback, useRef, useState } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { ClientScreen } from "@/features/coach/components/client-screen.tsx"
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
import { deleteClient, getClient, resetInvite } from "@/server/coach-clients.functions.ts"
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
  const inFlight = useRef(false)

  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
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
          await navigate({ to: "/clients" })
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
   */
  const share = useCallback(() => {
    const invite = client?.invite
    if (client === undefined || invite === undefined) return
    setError(undefined)
    void shareClientInvite({
      clientId: client.id,
      link: invite.url,
      message: invite.message,
    })
      .then(async (outcome) => {
        if (outcome === "gone") await router.invalidate()
        else if (outcome === "failed") setError(copy.common.failed)
      })
      .catch(() => setError(copy.common.failed))
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
          onResetInvite={reset}
          onDelete={remove}
          pending={pending}
          error={error}
        />
      </TimestampFormatProvider>
    </MiniAppShell>
  )
}
