import { UserAdd01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { Card } from "@/components/ui/card.tsx"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { useTimestampFormat } from "@/features/mini-app/timestamp-format.tsx"
import { cn } from "@/lib/utils.ts"
import type { CoachClients } from "@/server/coach-clients.ts"

/**
 * The coach's clients, as fixed-height rows flush inside one card: initials,
 * name, then a coloured state word with its dot and a timestamp behind it.
 *
 * **One component, two entrances** (#61). On `/clients` a row opens that client
 * and New client leads the list; in the New session picker a row *chooses* that
 * client and New client sits at the bottom, for the coach who came to schedule
 * somebody who does not exist yet. The rows are the same either way — a picker
 * that invented its own row shape would make the two screens read as two
 * different lists of the same people.
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
  onPick,
  newClientPosition = "first",
}: {
  readonly copy: ClientsCopy
  readonly clients: ReadonlyArray<CoachClients.ClientSummary>
  /**
   * Present in the picker, where a row is a choice rather than a destination.
   * Absent on the clients list, where it opens the client's own route.
   */
  readonly onPick?: (clientId: string) => void
  readonly newClientPosition?: "first" | "last"
}) {
  const newClient = (
    <li key="new-client">
      <Link to="/clients/new" className="flex min-h-16 items-center gap-4 px-5 py-3 text-left">
        <span className="bg-primary/15 text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
          <HugeiconsIcon icon={UserAdd01Icon} size={18} strokeWidth={2} />
        </span>
        <span className="text-primary text-[15px] font-semibold">{copy.newClient}</span>
      </Link>
    </li>
  )

  const rows =
    clients.length === 0
      ? [
          <li key="empty" className="text-muted-foreground px-5 py-5 text-sm leading-5">
            {copy.empty}
          </li>,
        ]
      : clients.map((client) => (
          <li key={client.id}>
            <ClientRow copy={copy} client={client} onPick={onPick} />
          </li>
        ))

  return (
    <Card className="mt-4 gap-0 overflow-hidden py-0">
      <ul className="divide-border divide-y">
        {newClientPosition === "first" ? [newClient, ...rows] : [...rows, newClient]}
      </ul>
    </Card>
  )
}

/** The row itself, as a destination or as a choice — the same face either way. */
function ClientRow({
  copy,
  client,
  onPick,
}: {
  readonly copy: ClientsCopy
  readonly client: CoachClients.ClientSummary
  /** Explicitly `| undefined`: this repository compiles with `exactOptionalPropertyTypes`. */
  readonly onPick: ((clientId: string) => void) | undefined
}) {
  const body: ReactNode = (
    <>
      <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
        {initials(client.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{client.name}</span>
        <ClientStateLine copy={copy} client={client} />
      </span>
    </>
  )
  const className = "flex min-h-16 w-full items-center gap-4 px-5 py-3 text-left"

  return onPick === undefined ? (
    <Link to="/clients/$clientId" params={{ clientId: client.id }} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" className={className} onClick={() => onPick(client.id)}>
      {body}
    </button>
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
