import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { createFileRoute } from "@tanstack/react-router"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { ClientsScreen } from "@/features/coach/components/clients-screen.tsx"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { coachTimestampFormat } from "@/features/mini-app/coach-timestamp-format.ts"
import { TimestampFormatProvider } from "@/features/mini-app/timestamp-format.tsx"
import { listClients } from "@/server/coach-clients.functions.ts"
import { loadCoachEntry } from "@/server/coach.functions.ts"

/**
 * The clients list, on a route of its own (#61) — the list #56 put on the home
 * screen, moved unchanged now that Today has the entrance. Reached from Today's
 * bottom navigation and left by the host's own back button.
 */
export const Route = createFileRoute("/clients/")({
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
  component: ClientsRoute,
})

function ClientsRoute() {
  const { entry, clients, launchLanguage } = Route.useLoaderData()
  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
  const copy = coachCopy(language)

  return (
    <MiniAppShell>
      <TelegramFullscreen />
      {clients.ok ? (
        <TimestampFormatProvider value={coachTimestampFormat(language)}>
          <ClientsScreen copy={copy} clients={clients.home.clients} />
        </TimestampFormatProvider>
      ) : (
        <EntryFrame
          icon={WifiDisconnected01Icon}
          tone="muted"
          title={copy.entry.unavailableTitle}
          body={copy.entry.unavailableBody}
        />
      )}
    </MiniAppShell>
  )
}
