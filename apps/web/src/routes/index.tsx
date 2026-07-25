import { BotIcon, WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useCallback, useRef, useState } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { Button } from "@/components/ui/button.tsx"
import { CoachHome } from "@/features/coach/components/coach-home.tsx"
import { TermsScreen } from "@/features/coach/components/terms-screen.tsx"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import {
  acceptCoachTerms,
  type CoachEntryTransportResult,
  loadCoachEntry,
} from "@/server/coach.functions.ts"

/**
 * The coach Mini App's entry (#54). Every coach launch lands here — the in-chat
 * "Open" button and the optional chat-list one both point at it — and the loader
 * resolves what this coach sees before anything paints.
 *
 * Client-only, because the credential is a browser fact: it arrives from the
 * Telegram host after the page loads. English-only in this slice (D4), with the
 * i18n foundation ticket as the named payer.
 */
export const Route = createFileRoute("/")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  loader: async (): Promise<CoachEntryTransportResult> =>
    loadCoachEntry().catch(() => ({ ok: false, error: "server" }) as const),
  component: CoachEntry,
})

/**
 * The Mini App URL for this coach's own bot — the exact address @BotFather
 * wants for the optional chat-list button. Built from wherever the app is
 * actually served rather than from a constant, so a stage and production each
 * print their own, and stripped of whatever the current launch appended.
 */
export const mainMiniAppUrlFor = (href: string, telegramBotId: string): string => {
  try {
    const url = new URL(href)
    url.hash = ""
    url.search = ""
    url.searchParams.set("b", telegramBotId)
    return url.toString()
  } catch {
    return ""
  }
}

/**
 * Run an action only while no run of it is outstanding.
 *
 * The guard is a ref rather than the `pending` state because Telegram's own
 * bottom button has no disabled state to set, and a re-render lands a tick too
 * late to stop the second tap of a double tap. One acceptance per intent.
 */
export const acceptOnce = (inFlight: { current: boolean }, run: () => Promise<void>): void => {
  if (inFlight.current) return
  inFlight.current = true
  void run().finally(() => {
    inFlight.current = false
  })
}

function CoachEntry() {
  const entry = Route.useLoaderData()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const inFlight = useRef(false)

  const retry = useCallback(() => void router.invalidate(), [router])

  const accept = useCallback(() => {
    if (entry.ok !== true || entry.entry.kind !== "terms-required") return
    const version = entry.entry.termsVersion
    acceptOnce(inFlight, async () => {
      setPending(true)
      setError(undefined)
      try {
        const result = await acceptCoachTerms({ data: { version } })
        if (result.ok) {
          await router.invalidate()
          return
        }
        setError(
          result.error === "stale"
            ? "These terms have been updated. Reopen the app to read the current version."
            : "That did not go through. Check your connection and try again.",
        )
      } catch {
        setError("That did not go through. Check your connection and try again.")
      } finally {
        setPending(false)
      }
    })
  }, [entry, router])

  return (
    <MiniAppShell>
      <TelegramFullscreen />
      <CoachScreen
        entry={entry}
        onAccept={accept}
        onRetry={retry}
        pending={pending}
        error={error}
      />
    </MiniAppShell>
  )
}

export function CoachScreen({
  entry,
  onAccept,
  onRetry,
  pending,
  error,
}: {
  readonly entry: CoachEntryTransportResult
  readonly onAccept: () => void
  readonly onRetry: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  if (!entry.ok) {
    // A refused credential is not a missing page: somebody opened the app from
    // somewhere it does not belong, and saying so beats a 404. Every refusal
    // reads the same, because the server deliberately cannot tell them apart.
    return entry.error === "unauthenticated" ? (
      <EntryFrame
        icon={BotIcon}
        tone="muted"
        title="Open Praximo from your bot"
        body="This app opens from the Praximo bot set up for your practice. Find it in Telegram and tap Open."
      />
    ) : (
      <EntryFrame
        icon={WifiDisconnected01Icon}
        tone="muted"
        title="We couldn't open Praximo"
        body="Something on our side is not answering. Try again in a moment."
      >
        <div className="mt-8">
          <Button className="w-full" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </EntryFrame>
    )
  }

  // The terms are a state of the entry, not a route of their own: a blocking
  // screen with a URL is a screen that can be bookmarked past.
  if (entry.entry.kind === "terms-required") {
    return <TermsScreen onAccept={onAccept} pending={pending} error={error} />
  }

  return (
    <CoachHome
      botUsername={entry.entry.botUsername}
      mainMiniAppUrl={mainMiniAppUrlFor(
        typeof window === "undefined" ? "" : window.location.href,
        entry.entry.telegramBotId,
      )}
      {...(entry.entry.relink === undefined ? {} : { relinkLink: entry.entry.relink.link })}
    />
  )
}
