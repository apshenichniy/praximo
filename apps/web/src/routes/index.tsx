import { BotIcon, WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import type { CoachLanguage } from "@praximo/domain"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { Button } from "@/components/ui/button.tsx"
import { CoachHome } from "@/features/coach/components/coach-home.tsx"
import { OnboardingFlow } from "@/features/coach/components/onboarding-flow.tsx"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { coachTimestampFormat } from "@/features/mini-app/coach-timestamp-format.ts"
import { TimestampFormatProvider } from "@/features/mini-app/timestamp-format.tsx"
import {
  type CoachClientsResult,
  hideMainMiniAppHint,
  listClients,
  saveTimezone,
} from "@/server/coach-clients.functions.ts"
import {
  acceptCoachTerms,
  chooseCoachLanguage,
  type CoachEntryTransportResult,
  loadCoachEntry,
} from "@/server/coach.functions.ts"

/**
 * The coach Mini App's entry (#54). Every coach launch lands here — the in-chat
 * "Open" button and the optional chat-list one both point at it — and the loader
 * resolves what this coach sees before anything paints.
 *
 * Client-only, because the credential is a browser fact: it arrives from the
 * Telegram host after the page loads. Every screen below an authenticated coach
 * renders in `member.language`; the two refusals above one render in the
 * language the launch itself claims, because at that point there is no member to
 * ask (#130).
 */
export interface CoachEntryLoaderData {
  readonly entry: CoachEntryTransportResult
  readonly launchLanguage: CoachLanguage
  /** Absent until a coach is past the terms — there is no practice to list yet. */
  readonly clients: CoachClientsResult | undefined
}

export const Route = createFileRoute("/")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  loader: async (): Promise<CoachEntryLoaderData> => {
    // Both halves come from the same launch, and the credential is memoized, so
    // this is one round trip rather than two.
    const [entry, credential] = await Promise.all([
      loadCoachEntry().catch(() => ({ ok: false, error: "server" }) as const),
      resolveLaunchCredential(),
    ])
    // The list is only asked for once there is a home to put it on: a coach who
    // has not accepted the terms has no clients, and asking anyway would spend a
    // round trip on the one screen that must paint fastest.
    const clients =
      entry.ok && entry.entry.kind === "home"
        ? await listClients().catch(() => ({ ok: false, error: "server" }) as const)
        : undefined
    return { entry, launchLanguage: launchLocale(credential.initData), clients }
  },
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
  const { entry, launchLanguage, clients } = Route.useLoaderData()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const inFlight = useRef(false)

  // An authenticated coach has a language of their own; anyone else gets what
  // their Telegram client asked for, because there is no member to ask.
  const copy = coachCopy(entry.ok ? entry.entry.language : launchLanguage)

  const retry = useCallback(() => void router.invalidate(), [router])

  /**
   * The coach's zone, written silently on every launch that finds it changed
   * (#56 §`member.timezone`). No UI, no reply worth waiting for: this is the
   * precondition for the *bot* being able to print "10:00 (UTC+3)" at all, and
   * a launch that fails to write it simply tries again next time.
   */
  useEffect(() => {
    if (!entry.ok || entry.entry.kind !== "home") return
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (typeof timezone !== "string" || timezone.length === 0) return
    void saveTimezone({ data: { timezone } }).catch(() => undefined)
  }, [entry])

  const hideHint = useCallback(() => {
    void hideMainMiniAppHint()
      .then(() => router.invalidate())
      .catch(() => undefined)
  }, [router])

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
        setError(result.error === "stale" ? copy.terms.staleError : copy.common.failed)
      } catch {
        setError(copy.common.failed)
      } finally {
        setPending(false)
      }
    })
  }, [copy, entry, router])

  /**
   * Persist the coach's choice, then let the flow move on — but only if the
   * write landed. A coach whose language did not save must not walk into terms
   * rendered from a database that disagrees with the screen they just left.
   */
  const chooseLanguage = useCallback(
    async (chosen: CoachLanguage): Promise<boolean> => {
      setPending(true)
      setError(undefined)
      try {
        const result = await chooseCoachLanguage({ data: { language: chosen } })
        if (result.ok) {
          await router.invalidate()
          return true
        }
        setError(coachCopy(chosen).common.failed)
        return false
      } catch {
        setError(coachCopy(chosen).common.failed)
        return false
      } finally {
        setPending(false)
      }
    },
    [router],
  )

  return (
    <MiniAppShell>
      <TelegramFullscreen />
      <CoachScreen
        entry={entry}
        launchLanguage={launchLanguage}
        clients={clients}
        onAccept={accept}
        onChooseLanguage={chooseLanguage}
        onHideHint={hideHint}
        onRetry={retry}
        pending={pending}
        error={error}
      />
    </MiniAppShell>
  )
}

export function CoachScreen({
  entry,
  launchLanguage,
  clients,
  onAccept,
  onChooseLanguage,
  onHideHint,
  onRetry,
  pending,
  error,
}: {
  readonly entry: CoachEntryTransportResult
  readonly launchLanguage: CoachLanguage
  readonly clients: CoachClientsResult | undefined
  readonly onAccept: () => void
  readonly onChooseLanguage: (language: CoachLanguage) => Promise<boolean>
  readonly onHideHint: () => void
  readonly onRetry: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  if (!entry.ok) {
    // A refused credential is not a missing page: somebody opened the app from
    // somewhere it does not belong, and saying so beats a 404. Every refusal
    // reads the same, because the server deliberately cannot tell them apart.
    const copy = coachCopy(launchLanguage)
    return entry.error === "unauthenticated" ? (
      <EntryFrame
        icon={BotIcon}
        tone="muted"
        title={copy.entry.notFromBotTitle}
        body={copy.entry.notFromBotBody}
      />
    ) : (
      <EntryFrame
        icon={WifiDisconnected01Icon}
        tone="muted"
        title={copy.entry.unavailableTitle}
        body={copy.entry.unavailableBody}
      >
        <div className="mt-8">
          <Button className="w-full" onClick={onRetry}>
            {copy.common.tryAgain}
          </Button>
        </div>
      </EntryFrame>
    )
  }

  // First login is a state of the entry, not a route: a blocking screen with a
  // URL is a screen that can be bookmarked past.
  if (entry.entry.kind === "terms-required") {
    return (
      <OnboardingFlow
        language={entry.entry.language}
        onChooseLanguage={onChooseLanguage}
        onAccept={onAccept}
        pending={pending}
        error={error}
      />
    )
  }

  return (
    <TimestampFormatProvider value={coachTimestampFormat(entry.entry.language)}>
      <CoachHome
        copy={coachCopy(entry.entry.language)}
        botUsername={entry.entry.botUsername}
        mainMiniAppUrl={mainMiniAppUrlFor(
          typeof window === "undefined" ? "" : window.location.href,
          entry.entry.telegramBotId,
        )}
        clients={clients?.ok === true ? clients.home.clients : []}
        hintVisible={clients?.ok === true && clients.home.mainMiniAppHintVisible}
        onHideHint={onHideHint}
        {...(entry.entry.relink === undefined ? {} : { relinkLink: entry.entry.relink.link })}
      />
    </TimestampFormatProvider>
  )
}
