import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { TelegramMainButton } from "@/components/telegram-main-button.tsx"
import { Button } from "@/components/ui/button.tsx"
import { ClientList } from "@/features/coach/components/client-list.tsx"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { ActionBar } from "@/features/mini-app/components/action-bar.tsx"
import type { CoachClients } from "@/server/coach-clients.ts"

/**
 * The clients list on a route of its own (#61).
 *
 * The same list #56 put on the home screen, moved unchanged once Today took the
 * entrance, and reached from Today's bottom navigation.
 *
 * **New client is the host's bottom button, not the list's first row** (#198).
 * It was a row because the list was one of several things on the home screen and
 * a floating button would have claimed the whole screen for it; on a route whose
 * only subject is clients, creating one *is* the screen's action, and the
 * platform has a fixed place for that. The row also had to be scrolled back to,
 * which is the argument `TelegramMainButton` was written against.
 *
 * The picker keeps its row — there the action is choosing a client, and creating
 * one is the escape hatch rather than the point.
 */
export function ClientsScreen({
  copy,
  clients,
  onCreate,
}: {
  readonly copy: CoachCopy
  readonly clients: ReadonlyArray<CoachClients.ClientSummary>
  readonly onCreate: () => void
}) {
  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-28">
      <TelegramBackButton label={copy.common.back} />
      <h1 className="mt-2 text-title font-semibold tracking-tight">{copy.clients.listTitle}</h1>
      <ClientList copy={copy.clients} clients={clients} newClientPosition="none" />

      <TelegramMainButton
        text={copy.clients.newClient}
        onClick={onCreate}
        fallback={
          <ActionBar>
            <Button className="w-full" onClick={onCreate}>
              {copy.clients.newClient}
            </Button>
          </ActionBar>
        }
      />
    </main>
  )
}
