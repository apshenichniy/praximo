import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"
import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { HostFullscreen } from "@/mini-app.tsx"
import { ClientsScreen } from "@/features/coach/components/clients-screen.tsx"
import { coachLaunch, orServerFailure } from "@/features/entry/coach-loader.ts"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { coachTimestampFormat } from "@/features/mini-app/coach-timestamp-format.ts"
import { TimestampFormatProvider } from "@/features/mini-app/timestamp-format.tsx"
import { listClients } from "@/server/coach-clients.functions.ts"

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
    const [launch, clients] = await Promise.all([coachLaunch(), orServerFailure(listClients())])
    return { ...launch, clients }
  },
  component: ClientsRoute,
})

function ClientsRoute() {
  const navigate = useNavigate()
  const { language, clients } = Route.useLoaderData()
  const copy = coachCopy(language)

  return (
    <MiniAppShell>
      <HostFullscreen />
      {clients.ok ? (
        <TimestampFormatProvider value={coachTimestampFormat(language)}>
          <ClientsScreen
            copy={copy}
            clients={clients.home.clients}
            onCreate={() => void navigate({ to: "/clients/new" })}
          />
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
