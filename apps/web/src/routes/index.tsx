import { BotIcon, WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import type { CoachLanguage } from "@praximo/domain"
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { useCallback, useRef, useState } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { TelegramMainButton } from "@/components/telegram-main-button.tsx"
import { Button } from "@/components/ui/button.tsx"
import { OnboardingFlow } from "@/features/coach/components/onboarding-flow.tsx"
import { TodayScreen } from "@/features/coach/components/today-screen.tsx"
import { shareClientInvite } from "@/features/coach/invite-share.ts"
import { useCoachTimezone } from "@/features/coach/use-coach-timezone.ts"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { impactHaptic, notifyHaptic } from "@/features/mini-app/haptics.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { ActionBar } from "@/features/mini-app/components/action-bar.tsx"
import { coachTimestampFormat } from "@/features/mini-app/coach-timestamp-format.ts"
import { TimestampFormatProvider } from "@/features/mini-app/timestamp-format.tsx"
import { resendInvite } from "@/server/coach-clients.functions.ts"
import { loadToday, type TodayResult } from "@/server/coach-sessions.functions.ts"
import {
  acceptCoachTerms,
  chooseCoachLanguage,
  type CoachEntryTransportResult,
  loadCoachEntry,
} from "@/server/coach.functions.ts"

/**
 * The coach Mini App's entry (#54), and since #61 the **Today dashboard** it
 * lands on. Every coach launch arrives here — the in-chat "Open" button and the
 * optional chat-list one both point at it — and the loader resolves what this
 * coach sees before anything paints.
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
  /** Absent until a coach is past the terms — there is no day to show yet. */
  readonly today: TodayResult | undefined
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
    // The day is only asked for once there is a screen to put it on: a coach who
    // has not accepted the terms has no practice, and asking anyway would spend
    // a round trip on the one screen that must paint fastest.
    const today =
      entry.ok && entry.entry.kind === "home"
        ? await loadToday().catch(() => ({ ok: false, error: "server" }) as const)
        : undefined
    return { entry, launchLanguage: launchLocale(credential.initData), today }
  },
  component: CoachEntry,
})

/**
 * The Mini App URL for this coach's own bot — the exact address @BotFather
 * wants for the optional chat-list button. Built from wherever the app is
 * actually served rather than from a constant, so a stage and production each
 * print their own, and stripped of whatever the current launch appended.
 *
 * The **path** is reset too, not just the query (#61): the address is now
 * printed on `/main-mini-app`, and an address ending in the name of the screen
 * that shows it would send every chat-list launch to the hint instead of Today.
 */
export const mainMiniAppUrlFor = (href: string, telegramBotId: string): string => {
  try {
    const url = new URL(href)
    url.hash = ""
    url.search = ""
    url.pathname = "/"
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
  const { entry, launchLanguage, today } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [resending, setResending] = useState<string>()
  const inFlight = useRef(false)

  // An authenticated coach has a language of their own; anyone else gets what
  // their Telegram client asked for, because there is no member to ask.
  const copy = coachCopy(entry.ok ? entry.entry.language : launchLanguage)

  const retry = useCallback(() => void router.invalidate(), [router])

  useCoachTimezone(entry.ok && entry.entry.kind === "home")

  const accept = useCallback(() => {
    if (entry.ok !== true || entry.entry.kind !== "terms-required") return
    const version = entry.entry.termsVersion
    acceptOnce(inFlight, async () => {
      setPending(true)
      setError(undefined)
      try {
        const result = await acceptCoachTerms({ data: { version } })
        if (result.ok) {
          notifyHaptic("success")
          await router.invalidate()
          return
        }
        notifyHaptic("error")
        setError(result.error === "stale" ? copy.terms.staleError : copy.common.failed)
      } catch {
        notifyHaptic("error")
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
        notifyHaptic("error")
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

  /**
   * The resend action on an unaccepted session's card (#61).
   *
   * Two steps, and only the first one is held: the server hands back an
   * invitation that still opens something — minting a fresh one when the link on
   * file has lapsed, which is exactly the case this action exists for — and the
   * share that follows settles when Telegram's own picker calls back. Holding
   * the busy flag across that would let one silent client leave the button
   * disabled until the coach relaunched, and the picker is modal over the app
   * anyway (#179).
   */
  const resend = useCallback(
    (clientId: string) => {
      if (resending !== undefined) return
      setResending(clientId)
      setError(undefined)
      void resendInvite({ data: { clientId } })
        .then(async (result) => {
          setResending(undefined)
          if (!result.ok) {
            setError(copy.common.failed)
            return
          }
          if (!result.outcome.resent) {
            // The screen has gone stale — usually because the client accepted
            // between it drawing and this tap. Re-reading is what shows them why.
            setError(
              result.outcome.reason === "accepted" ? copy.today.resendAccepted : copy.common.failed,
            )
            await router.invalidate()
            return
          }
          impactHaptic()
          const outcome = await shareClientInvite({
            clientId,
            link: result.outcome.url,
            message: result.outcome.message,
          })
          if (outcome === "failed") setError(copy.common.failed)
          // A dismissed picker is silent — the invitation is untouched, and
          // telling a coach who changed their mind that nothing was sent reads
          // as a failure they have to act on. The screen is re-read either way,
          // because a reissue changed what it was showing.
          await router.invalidate()
        })
        .catch(() => {
          setResending(undefined)
          setError(copy.common.failed)
        })
    },
    [copy, resending, router],
  )

  const startCreation = useCallback(() => {
    const empty = today?.ok === true && today.today.emptyPractice
    void navigate({ to: empty ? "/clients/new" : "/sessions/new" })
  }, [navigate, today])

  return (
    <MiniAppShell>
      <TelegramFullscreen />
      <CoachScreen
        entry={entry}
        launchLanguage={launchLanguage}
        today={today}
        onAccept={accept}
        onChooseLanguage={chooseLanguage}
        onCreate={startCreation}
        onResend={resend}
        onRetry={retry}
        pending={pending}
        resending={resending}
        error={error}
      />
    </MiniAppShell>
  )
}

export function CoachScreen({
  entry,
  launchLanguage,
  today,
  onAccept,
  onChooseLanguage,
  onCreate,
  onResend,
  onRetry,
  pending,
  resending,
  error,
}: {
  readonly entry: CoachEntryTransportResult
  readonly launchLanguage: CoachLanguage
  readonly today: TodayResult | undefined
  readonly onAccept: () => void
  readonly onChooseLanguage: (language: CoachLanguage) => Promise<boolean>
  readonly onCreate: () => void
  readonly onResend: (clientId: string) => void
  readonly onRetry: () => void
  readonly pending: boolean
  readonly resending: string | undefined
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

  const copy = coachCopy(entry.entry.language)

  // Today failing is not the coach's problem to solve on this screen: the
  // dashboard renders as an empty practice would, and the retry lives where
  // every other refusal does.
  if (today?.ok !== true) {
    return (
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

  const view = today.today

  return (
    <TimestampFormatProvider value={coachTimestampFormat(entry.entry.language)}>
      <TodayScreen
        copy={copy}
        language={entry.entry.language}
        today={view}
        botUsername={entry.entry.botUsername}
        onResend={onResend}
        resending={resending}
        error={error}
        {...(entry.entry.relink === undefined ? {} : { relinkLink: entry.entry.relink.link })}
      />
      {/*
        The host's bottom button, and the one thing on this screen that creates
        anything. It says `New client` on an empty practice — `New session`
        there would open a picker with nothing in it, which is the one rule this
        codebase keeps returning to — and becomes `New session` the moment one
        client exists.
      */}
      <TelegramMainButton
        text={view.emptyPractice ? copy.today.newClient : copy.today.newSession}
        onClick={onCreate}
        fallback={
          <ActionBar>
            <Button className="w-full" onClick={onCreate}>
              {view.emptyPractice ? copy.today.newClient : copy.today.newSession}
            </Button>
          </ActionBar>
        }
      />
    </TimestampFormatProvider>
  )
}
