import type { ClientInviteDeliveryKind, ClientInviteDoor } from "@praximo/domain"

import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"

/**
 * Where a client stands, said the same way on both surfaces that say it (#224).
 *
 * The list says it as a coloured word and the client's own screen as a badge
 * (#198), but the *rule* underneath is one rule — «Не отправлено» until the
 * coach has actually handed something over — and it was worth exactly one place
 * the moment there were two readers of it. Two copies of a four-arm cascade is
 * how the hero and the row start disagreeing about the same client.
 *
 * In `coach` rather than in `mini-app` beside the primitives it is used with:
 * this is what a client's invitation *means*, not a surface widget, and the
 * shared feature deliberately depends on nothing (#167).
 */

export interface InviteStanding {
  readonly state: "invited" | "expired" | "accepted"
  /** Absent until the coach's first successful share or copy. */
  readonly delivered?: { readonly at: string; readonly kind: ClientInviteDeliveryKind }
}

/**
 * Nothing has left the coach's screen yet.
 *
 * Only ever true of an *invited* client: an expired invitation was still an
 * invitation, and a client who accepted plainly received one.
 */
export const isNotSent = (client: InviteStanding): boolean =>
  client.state === "invited" && client.delivered === undefined

export const stateWord = (copy: ClientsCopy, client: InviteStanding): string =>
  client.state === "accepted"
    ? copy.stateAccepted
    : client.state === "expired"
      ? copy.stateExpired
      : isNotSent(client)
        ? copy.stateNotSent
        : copy.stateInvited

/**
 * How it travelled. The server has already narrowed the database string to the
 * domain vocabulary, so the browser only renames that trusted kind.
 *
 * Since #58 that includes `email`, which used to leave here as `undefined` while
 * the service-sent invitation was unbuilt. The words are keyed by *delivery
 * kind* and not by door: `email` is how a message travelled, never a chip a
 * coach can press, and reading `copy.doors[kind]` would have forced it to be
 * declared one.
 */
export const sentVia = (
  copy: ClientsCopy,
  kind: ClientInviteDeliveryKind | undefined,
): string | undefined => (kind === undefined ? undefined : copy.sentVia[kind])

/**
 * Which door the client's screen should open on, given how the invitation last
 * travelled (#58).
 *
 * Not the identity it looks like, and that is the whole reason it exists:
 * **`email` opens the Link door.** What the service put in that message was the
 * web URL, so the Acceptance Page is what the client is holding and the Link
 * door is where the resend lives — as the door's own lead action, since #58.
 * Falling back to Telegram — which is what a plain «is this a door?» check does,
 * since `email` is not one — would sit a Telegram control set under «отправлено
 * письмом», exactly the drift #224 opened this default to prevent.
 */
export const doorFor = (kind: ClientInviteDeliveryKind | undefined): ClientInviteDoor =>
  kind === "email" || kind === "link" ? "link" : "telegram"
