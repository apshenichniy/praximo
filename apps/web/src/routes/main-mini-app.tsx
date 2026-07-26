import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useCallback } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { MainMiniAppScreen } from "@/features/coach/components/main-mini-app-screen.tsx"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { mainMiniAppUrlFor } from "@/routes/index.tsx"
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
    void hideMainMiniAppHint()
      .then(() => router.invalidate())
      .catch(() => undefined)
  }, [router])

  return (
    <MiniAppShell>
      <TelegramFullscreen />
      <MainMiniAppScreen
        copy={copy}
        mainMiniAppUrl={mainMiniAppUrlFor(
          typeof window === "undefined" ? "" : window.location.href,
          entry.ok && entry.entry.kind === "home" ? entry.entry.telegramBotId : "",
        )}
        onHide={hide}
      />
    </MiniAppShell>
  )
}
