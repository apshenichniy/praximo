import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { ClientList } from "@/features/coach/components/client-list.tsx"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import type { CoachClients } from "@/server/coach-clients.ts"

/**
 * The one step that precedes the scheduling sheet when the booking starts from
 * Today (#61): **pick the client**.
 *
 * From the client route this screen does not exist — the coach is already
 * looking at the person, and #56's sheet opens straight onto them.
 *
 * Clients with a pending invitation are **in** the list rather than filtered out:
 * scheduling before acceptance is deliberate
 * (client-onboarding-auth.md §Session-first flow), and the row's own state word
 * already says what has not happened yet.
 *
 * The rejected alternative was one sheet with the client as a field. Everything
 * below that field is dead until it is filled, which is the disabled-form shape
 * this app has ruled out elsewhere.
 */
export function ClientPickerScreen({
  copy,
  clients,
  onPick,
}: {
  readonly copy: CoachCopy
  readonly clients: ReadonlyArray<CoachClients.ClientSummary>
  readonly onPick: (clientId: string) => void
}) {
  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <TelegramBackButton label={copy.common.back} />

      <header className="mt-2">
        <h1 className="text-title font-semibold tracking-tight">{copy.sessions.pickTitle}</h1>
        <p className="text-muted-foreground mt-1 text-body leading-5">
          {clients.length === 0 ? copy.sessions.pickEmpty : copy.sessions.pickLead}
        </p>
      </header>

      {/*
        New client sits at the *bottom* here, not at the top: this screen exists
        to choose among the people who already are clients, and the coach who
        came to schedule somebody who is not one yet is the exception the row
        serves rather than the case it leads with.
      */}
      <ClientList copy={copy.clients} clients={clients} onPick={onPick} newClientPosition="last" />
    </main>
  )
}
