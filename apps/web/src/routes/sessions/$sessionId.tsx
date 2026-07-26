import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { createFileRoute } from "@tanstack/react-router"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { SessionScreen } from "@/features/coach/components/session-screen.tsx"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { getSession } from "@/server/coach-sessions.functions.ts"
import { loadCoachEntry } from "@/server/coach.functions.ts"

/**
 * One session — a **stub** in this ticket (#61), so that the list rows and
 * Today's cards lead somewhere complete-looking. #62 is the named creditor: it
 * develops this into the real screen with reschedule, cancel and the artifacts.
 */
export const Route = createFileRoute("/sessions/$sessionId")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  loader: async ({ params }) => {
    const [entry, detail, credential] = await Promise.all([
      loadCoachEntry().catch(() => ({ ok: false, error: "server" }) as const),
      getSession({ data: { sessionId: params.sessionId } }).catch(
        () => ({ ok: false, error: "server" }) as const,
      ),
      resolveLaunchCredential(),
    ])
    return { entry, detail, launchLanguage: launchLocale(credential.initData) }
  },
  component: SessionRoute,
})

function SessionRoute() {
  const { entry, detail, launchLanguage } = Route.useLoaderData()
  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
  const copy = coachCopy(language)
  const session = detail.ok ? detail.session : undefined

  return (
    <MiniAppShell>
      <TelegramFullscreen />
      {session === undefined ? (
        <EntryFrame
          icon={WifiDisconnected01Icon}
          tone="muted"
          title={copy.entry.unavailableTitle}
          body={detail.ok ? copy.sessions.notFound : copy.entry.unavailableBody}
        />
      ) : (
        <SessionScreen copy={copy} language={language} session={session} />
      )}
    </MiniAppShell>
  )
}
