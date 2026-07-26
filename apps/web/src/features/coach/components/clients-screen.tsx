import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { ClientList } from "@/features/coach/components/client-list.tsx"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import type { CoachClients } from "@/server/coach-clients.ts"

/**
 * The clients list on a route of its own (#61).
 *
 * The same list #56 put on the home screen, moved unchanged now that Today has
 * taken the entrance — New client is still the list's own first row, and it is
 * reached from Today's bottom navigation.
 */
export function ClientsScreen({
  copy,
  clients,
}: {
  readonly copy: CoachCopy
  readonly clients: ReadonlyArray<CoachClients.ClientSummary>
}) {
  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <TelegramBackButton label={copy.common.back} />
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{copy.clients.listTitle}</h1>
      <ClientList copy={copy.clients} clients={clients} />
    </main>
  )
}
