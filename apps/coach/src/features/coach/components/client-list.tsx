import { UserAdd01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { Card } from "@praximo/ui/components/card"
import { PersonAvatar } from "@praximo/ui/custom/person-avatar"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { isNotSent, sentVia, stateWord } from "@/features/coach/invite-standing.ts"
import { useClientPhoto } from "@/features/coach/use-client-photo.ts"
import { useTimestampFormat } from "@/features/mini-app/timestamp-format.tsx"
import { cn } from "@praximo/ui"
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
  invited: "text-warning",
  expired: "text-destructive",
  accepted: "text-success",
}

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
  /**
   * `"none"` on the clients route, where creating is the host's bottom button
   * rather than a row that scrolls away (#198). The picker keeps `"last"`: there
   * the action is choosing somebody, and creating is the escape hatch.
   */
  readonly newClientPosition?: "first" | "last" | "none"
}) {
  const newClient = (
    <li key="new-client">
      <Link
        to="/clients/new"
        className="transition-colors duration-100 active:bg-muted flex min-h-16 items-center gap-4 px-5 py-3 text-left"
      >
        <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
          <HugeiconsIcon icon={UserAdd01Icon} size={18} strokeWidth={2} />
        </span>
        <span className="text-primary text-base leading-relaxed font-semibold">
          {copy.newClient}
        </span>
      </Link>
    </li>
  )

  const rows =
    clients.length === 0
      ? [
          <li
            key="empty"
            className="text-muted-foreground px-5 py-5 text-base leading-relaxed leading-5"
          >
            {copy.empty}
          </li>,
        ]
      : // No stagger, deliberately (§Motion). The list rides in on the screen
        // transition that brought it, and a second animation on top of that one
        // read as a wave running down the rows — noticeable in the picker, which
        // a coach opens on the way to every booking rather than once.
        clients.map((client) => (
          <li key={client.id}>
            <ClientRow copy={copy} client={client} onPick={onPick} />
          </li>
        ))

  return (
    <Card className="mt-4 gap-0 overflow-hidden py-0">
      <ul className="divide-border divide-y">
        {newClientPosition === "none"
          ? rows
          : newClientPosition === "first"
            ? [newClient, ...rows]
            : [...rows, newClient]}
      </ul>
    </Card>
  )
}

/**
 * The face on a row: their photo when the platform has one, their initials when it
 * does not (#231).
 *
 * Initials are not a placeholder here. Most clients will never have a photo — nobody
 * is asked to upload one — so the fallback is the ordinary case, and it renders on the
 * first paint rather than after an empty disc.
 */
function ClientDisc({ client }: { readonly client: CoachClients.ClientSummary }) {
  const photo = useClientPhoto(client.id, client.hasAvatar)

  return (
    <PersonAvatar
      name={client.name}
      {...(photo === undefined ? {} : { photoSrc: photo })}
      size="row"
    />
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
      <ClientDisc client={client} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base leading-relaxed font-medium">{client.name}</span>
        <ClientStateLine copy={copy} client={client} />
      </span>
    </>
  )
  const className =
    "transition-colors duration-100 active:bg-muted flex min-h-16 w-full items-center gap-4 px-5 py-3 text-left"

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
 *
 * Since #224 an invited client reads in one of two ways. Before the coach has
 * handed anything over the row says «Не отправлено» in the muted tone — the
 * ordinary next step on a client created a minute ago, not an alarm. After it,
 * the row names the moment it went **and the door it went through**: a coach
 * coming back a week later needs to know what this person is holding, and the
 * door is also where their reminders will go.
 *
 * The expiry moves aside for that pair rather than joining it. Three facts do
 * not fit one truncating line on a phone, and the invitations whose window is
 * closing are already Today's needs-attention section (#61) — where they are
 * something to act on rather than a countdown to read.
 */
export function ClientStateLine({
  copy,
  client,
}: {
  readonly copy: ClientsCopy
  readonly client: CoachClients.ClientSummary
}) {
  const format = useTimestampFormat()
  const notSent = isNotSent(client)
  const door = sentVia(copy, client.delivered?.kind)
  const moment =
    client.state === "accepted" && client.acceptedAt !== undefined
      ? `${copy.acceptedPrefix}${format.relative(client.acceptedAt)}`
      : client.state === "invited"
        ? client.delivered === undefined || door === undefined
          ? `${copy.expiresPrefix}${format.relative(client.inviteExpiresAt)}`
          : `${format.relative(client.delivered.at)} · ${door}`
        : `${copy.invitedPrefix}${format.relative(client.invitedAt)}`

  return (
    <span className="mt-0.5 flex items-center gap-2 text-xs leading-normal">
      <span
        className={cn(
          "flex items-center gap-1.5 font-medium",
          notSent ? "text-muted-foreground" : stateStyles[client.state],
        )}
      >
        <span className="size-1.5 rounded-full bg-current" />
        {stateWord(copy, client)}
      </span>
      <span className="text-muted-foreground truncate">{moment}</span>
    </span>
  )
}
