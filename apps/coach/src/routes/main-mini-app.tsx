import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useCallback } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { HostFullscreen } from "@/presentation-host"
import { MainMiniAppScreen } from "@/features/coach/components/main-mini-app-screen.tsx"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { mainMiniAppUrlFor } from "@/routes/index.tsx"
import { impactHaptic } from "@/presentation-host"
import { hideMainMiniAppHint } from "@/server/coach-clients.functions.ts"
import { loadCoachEntry } from "@/server/coach.functions.ts"

/**
 * The optional @BotFather steps, behind Today's one-row hint (#61).
 *
 * A route rather than a section, because the row on the dashboard reads as its
 * payoff and this is where the mechanism lives — including **Hide**, which
 * deliberately exists nowhere else.
 */
export const Route = createFileRoute("/main-mini-app")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  loader: async () => {
    const [entry, credential] = await Promise.all([
      loadCoachEntry().catch(() => ({ ok: false, error: "server" }) as const),
      resolveLaunchCredential(),
    ])
    return { entry, launchLanguage: launchLocale(credential.initData) }
  },
  component: MainMiniAppRoute,
})

function MainMiniAppRoute() {
  const { entry, launchLanguage } = Route.useLoaderData()
  const router = useRouter()
  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
  const copy = coachCopy(language)

  const hide = useCallback(() => {
    // A control that dismisses something rather than an outcome to report: the
    // hint going away is the whole confirmation, so this is punctuation (§Motion).
    impactHaptic()
    void hideMainMiniAppHint()
      .then(() => router.invalidate())
      .catch(() => undefined)
  }, [router])

  // The whole screen is one address. Without a resolved coach there is no bot id
  // to build it from, and printing `?b=` with nothing after it would hand out a
  // confidently wrong address on the one screen whose entire job is that address.
  if (!entry.ok || entry.entry.kind !== "home") {
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
      <MainMiniAppScreen
        copy={copy}
        mainMiniAppUrl={mainMiniAppUrlFor(
          typeof window === "undefined" ? "" : window.location.href,
          entry.entry.telegramBotId,
        )}
        onHide={hide}
      />
    </MiniAppShell>
  )
}
