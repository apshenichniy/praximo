import { Schema } from "effect"
import { CoachOnboardingInviteCodeAlphabet } from "./coach-onboarding.ts"
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
