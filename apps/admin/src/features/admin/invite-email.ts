import type { CoachLanguage } from "@praximo/domain"

/**
 * What the sheet knows when the manager taps "Send invite" — and what the real
 * sender will need: the two idempotency-bearing create inputs the other
 * channels already pass (`requestId`, `name`) plus the address and the
 * language of the message.
 */
export interface InviteEmailRequest {
  readonly requestId: string
  readonly name: string
  readonly email: string
  readonly language: CoachLanguage
}

export const EmailComingSoon = "Email delivery is coming soon"

/**
 * The one seam the email channel hangs on (#105). Everything above it — the
 * sheet, its validation, the toast — ships now; delivery lands later on
 * Cloudflare Email Service + React Email (decision of record, superseding
 * Resend; #58 shares the stack for client invites).
 *
 * Until then it reaches no server and resolves with what to tell the manager,
 * which is what makes the acceptance criterion true by construction: no email
 * leaves, no workspace or invite is created, and no delivery channel is
 * recorded. The real sender replaces this function.
 */
export const sendCoachInviteEmail = (_request: InviteEmailRequest): Promise<string> =>
  Promise.resolve(EmailComingSoon)
