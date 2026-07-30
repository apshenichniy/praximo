import { Schema } from "effect"
import { CoachOnboardingInviteCodeAlphabet } from "./coach-onboarding.ts"
import { bareOrigin } from "./origin.ts"
import { CoachLanguage } from "./workspace-create.ts"

export const ClientId = Schema.NonEmptyString.pipe(Schema.brand("ClientId"))
export type ClientId = typeof ClientId.Type

export const ClientInviteId = Schema.NonEmptyString.pipe(Schema.brand("ClientInviteId"))
export type ClientInviteId = typeof ClientInviteId.Type

/**
 * Long enough for the names a coach actually types, short enough that a list row
 * can show one. Truncation is the screen's business; refusal is this.
 */
export const ClientNameMaxLength = 80

export const ClientName = Schema.Trim.check(Schema.isMinLength(1)).check(
  Schema.isMaxLength(ClientNameMaxLength),
)

/**
 * What the New client screen commits: a name and the language the invitation is
 * written in.
 *
 * `inviteLanguage` is the language of the *message*, never of the client — the
 * client picks their own when they accept, and the screen says so beside the
 * chips. It lands on `invite.delivery.language`, which #57 needs for the email
 * invitation and the Acceptance Page's pre-selection.
 */
export const CreateClientInput = Schema.Struct({
  name: ClientName,
  inviteLanguage: CoachLanguage,
})
export type CreateClientInput = typeof CreateClientInput.Type

/**
 * The same readable alphabet as the coach onboarding code — no `0 O 1 I`, so a
 * token can be read off a screen — over **twelve** symbols rather than eight.
 *
 * The extra length is bought by a second door: #57 puts this token in a web URL,
 * where guessing is HTTP and parallel rather than rate-limited by Telegram, and
 * a guessed client token is a stranger becoming somebody's client and receiving
 * their join links.
 */
export const ClientInviteTokenAlphabet = CoachOnboardingInviteCodeAlphabet
export const ClientInviteTokenLength = 12
export const ClientInviteTokenPattern = new RegExp(
  `^[${ClientInviteTokenAlphabet}]{${ClientInviteTokenLength}}$`,
)

/** Single-use, seven days. The window starts at creation, not at delivery. */
export const ClientInviteTtlMillis = 7 * 24 * 60 * 60 * 1_000

/**
 * How close to its expiry an invitation has to be before Today calls it out
 * (#61).
 *
 * Two days of a seven-day window, so the section names the invitations a coach
 * can still do something about rather than every one that is open. *Every*
 * pending invitation would make needs-attention the biggest thing on a fresh
 * practice and a duplicate of the clients list — a coach who has just invited
 * five people would be reading a list of problems.
 */
export const InviteAttentionWindowMillis = 2 * 24 * 60 * 60 * 1_000

/**
 * Whether an invitation belongs in Today's needs-attention section: already
 * lapsed, or inside its last two days.
 *
 * Derived from the moment rather than stored, exactly as the state word is —
 * there is no cron writing `expired`, so "is this urgent" has to be a read.
 */
export const inviteNeedsAttention = (
  state: "invited" | "expired" | "accepted",
  expiresAt: Date,
  now: Date,
): boolean => {
  if (state === "accepted") return false
  if (state === "expired") return true
  return expiresAt.getTime() - now.getTime() <= InviteAttentionWindowMillis
}

export const ClientInviteStatus = Schema.Literals(["pending", "accepted", "expired"])
export type ClientInviteStatus = typeof ClientInviteStatus.Type

/**
 * What an invitation is, given its stored status and the clock.
 *
 * Acceptance wins over time because a used invitation is done, not late. A
 * stored `expired` is a different fact from time elapsing: it is the marker a
 * reissue writes when a newer invitation supersedes this one.
 */
export const inviteStanding = (
  status: ClientInviteStatus,
  expiresAt: number,
  now: number,
): "open" | "accepted" | "superseded" | "lapsed" => {
  if (status === "accepted") return "accepted"
  if (status === "expired") return "superseded"
  return expiresAt <= now ? "lapsed" : "open"
}

/** The `?start=` payload carried by the client's deep link into the coach's bot. */
export const ClientInviteStartPrefix = "inv_"

export const clientInviteStartParameter = (token: string): string =>
  `${ClientInviteStartPrefix}${token}`

/**
 * The cheap filter in front of the database: a `/start` payload that cannot be a
 * token never becomes a query, and is answered exactly like a stranger's bare
 * `/start` — which is also the answer for a token from another coach's
 * workspace, so neither discloses that the other exists.
 */
export const parseClientInviteStartParameter = (parameter: string): string | undefined => {
  if (!parameter.startsWith(ClientInviteStartPrefix)) return undefined
  const token = parameter.slice(ClientInviteStartPrefix.length)
  return ClientInviteTokenPattern.test(token) ? token : undefined
}

/**
 * The token's other door: the Acceptance Page's own path (#57).
 *
 * `/i/` rather than `/invite/` because the coach pastes this link by hand into
 * other messengers, where every character is one the client may have to read
 * back to them.
 */
export const ClientInviteWebPath = "/i/"

/**
 * The web form of an invitation, beside the deep-link form above (#224).
 *
 * Both forms of one token live here together so no screen has to know either
 * shape. The coach's Mini App builds this from `CLIENT_APP_URL`, which is the
 * origin the stack actually deployed rather than a hostname somebody typed.
 *
 * The origin is scrubbed by `bareOrigin`, which the legal texts share: this link
 * is forwarded to a client, and a parameter the origin happened to carry would
 * ride into somebody else's chat.
 */
export const clientInviteUrl = (origin: string, token: string): string =>
  `${bareOrigin(origin)}${ClientInviteWebPath}${token}`

/**
 * The brand mark as it travels in the invitation email (#58).
 *
 * Beside `clientInviteUrl` because it is the same message and the same origin:
 * the email carries a link and a logo, both built on the Client app's deployed
 * host, and neither should be assembled by hand at a call site. Gmail strips
 * SVG, so this is a PNG published from `apps/client/public/brand/` rather than
 * `@praximo/ui`'s `PraximoMark`.
 *
 * `bareOrigin` for the same reason the invitation URL needs it: this string ends
 * up in an `<img src>` in somebody's mailbox, and a stage's `?b=<botId>` riding
 * along would say something about who was sent it.
 */
export const clientBrandMarkUrl = (origin: string): string =>
  `${bareOrigin(origin)}/brand/praximo-mark.png`

/**
 * Which door an invitation was actually handed over through (#224).
 *
 * The spec's own set. `telegram` is what an invitation is created with, `link`
 * is the hand-forwarded web URL, and `email` is the service-sent invitation
 * (#58) — modelled here rather than added later so the column this lands in has
 * one vocabulary rather than a growing pile of string literals.
 *
 * This is *not* `channel.kind`: a channel is an address we can reach and exists
 * only after acceptance. This is how the invitation travelled.
 */
export const ClientInviteDeliveryKind = Schema.Literals(["telegram", "email", "link"])
export type ClientInviteDeliveryKind = typeof ClientInviteDeliveryKind.Type

/**
 * A narrowing for the read side, where the column is a plain `string` and may
 * hold a value written by a deploy this one predates.
 *
 * Beside {@link isClientInviteDoor} rather than instead of it: the two answer
 * different questions. That one asks «is this a chip the coach could have
 * pressed», this one asks «is this a route we have a word for» — and since #58
 * the second set is strictly larger.
 */
export const isClientInviteDeliveryKind = (
  value: string | undefined,
): value is ClientInviteDeliveryKind =>
  ClientInviteDeliveryKind.literals.some((literal) => literal === value)

/**
 * The kinds a coach hands over **by hand** — the two forms of the token that a
 * screen can offer as a choice (CONTEXT.md §Door).
 *
 * A strict subset of the kinds above, and the line between them is who does the
 * sending: `email` is the *service* delivering an invitation on its own (#58),
 * which is not a button a coach presses and so never a position on the segment.
 * Naming the subset is what keeps that distinction from being re-derived, by
 * hand and slightly differently, at each screen that draws the choice.
 */
export const ClientInviteDoor = Schema.Literals(["telegram", "link"])
export type ClientInviteDoor = typeof ClientInviteDoor.Type

export const isClientInviteDoor = (value: string | undefined): value is ClientInviteDoor =>
  ClientInviteDoor.literals.some((literal) => literal === value)
