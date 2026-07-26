import { UserAdd01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"

import { Card } from "@/components/ui/card.tsx"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { useTimestampFormat } from "@/features/mini-app/timestamp-format.tsx"
import { cn } from "@/lib/utils.ts"
import type { CoachClients } from "@/server/coach-clients.ts"

/**
 * The coach's clients, as the home screen's second section (#56 §Home).
 *
 * Fixed-height rows, flush inside one card: initials, name, then a coloured
 * state word with its dot and a timestamp behind it. **New client is the first
 * row of that list**, in the primary colour — the same shape the admin's coach
 * list uses for its own creation row, and the reason the host's bottom button
 * stays empty here: mini-app.md has already promised it to «New session» on
 * Today, and teaching a control only to move it is worse than not teaching it.
 */

const stateStyles: Record<CoachClients.ClientSummary["state"], string> = {
  invited: "text-amber-300",
  expired: "text-rose-300",
  accepted: "text-emerald-300",
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

export function ClientList({
  copy,
  clients,
}: {
  readonly copy: ClientsCopy
  readonly clients: ReadonlyArray<CoachClients.ClientSummary>
}) {
  return (
    <Card className="mt-4 gap-0 overflow-hidden py-0">
      <ul className="divide-border divide-y">
        <li>
          <Link
            to="/clients/new"
            className="flex min-h-16 items-center gap-4 px-5 py-3 text-left"
          >
            <span className="bg-primary/15 text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
              <HugeiconsIcon icon={UserAdd01Icon} size={18} strokeWidth={2} />
            </span>
            <span className="text-primary text-[15px] font-semibold">{copy.newClient}</span>
          </Link>
        </li>

        {clients.length === 0 ? (
          <li className="text-muted-foreground px-5 py-5 text-sm leading-5">{copy.empty}</li>
        ) : (
          clients.map((client) => (
            <li key={client.id}>
              <Link
                to="/clients/$clientId"
                params={{ clientId: client.id }}
                className="flex min-h-16 items-center gap-4 px-5 py-3 text-left"
              >
                <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                  {initials(client.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{client.name}</span>
                  <ClientStateLine copy={copy} client={client} />
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </Card>
  )
}

/**
 * The state word, its dot, and the moment behind it.
 *
 * Colour carries the state and nothing else — session *kind* is a word with a
 * glyph and no colour of its own, so the two vocabularies never compete.
 */
export function ClientStateLine({
  copy,
  client,
}: {
  readonly copy: ClientsCopy
  readonly client: CoachClients.ClientSummary
}) {
  const format = useTimestampFormat()
  const word =
    client.state === "accepted"
      ? copy.stateAccepted
      : client.state === "expired"
        ? copy.stateExpired
        : copy.stateInvited
  const moment =
    client.state === "accepted" && client.acceptedAt !== undefined
      ? `${copy.acceptedPrefix}${format.relative(client.acceptedAt)}`
      : client.state === "invited"
        ? `${copy.expiresPrefix}${format.relative(client.inviteExpiresAt)}`
        : `${copy.invitedPrefix}${format.relative(client.invitedAt)}`

  return (
    <span className="mt-0.5 flex items-center gap-2 text-xs">
      <span className={cn("flex items-center gap-1.5 font-medium", stateStyles[client.state])}>
        <span className="size-1.5 rounded-full bg-current" />
        {word}
      </span>
      <span className="text-muted-foreground truncate">{moment}</span>
    </span>
  )
}
