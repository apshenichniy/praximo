import { isClientInviteDoor } from "@praximo/domain"

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
  readonly delivered?: { readonly at: string; readonly kind: string }
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
 * Which door it went out through, or `undefined` for a kind this deploy has no
 * word for — the same refusal `coach-clients.ts` makes on the way out, because a
 * raw identifier in the middle of a sentence is worse than a quieter row.
 *
 * `email` reaches here as a kind and leaves as `undefined` on purpose: the
 * service-sent invitation is #58's, and until it has copy of its own a row about
 * one should say less rather than guess.
 */
export const sentVia = (copy: ClientsCopy, kind: string | undefined): string | undefined =>
  isClientInviteDoor(kind) ? copy.doors[kind].sentVia : undefined
