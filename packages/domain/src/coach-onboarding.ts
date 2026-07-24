import { Schema } from "effect"

export const CoachOnboardingInviteId = Schema.NonEmptyString.pipe(
  Schema.brand("CoachOnboardingInviteId"),
)
export type CoachOnboardingInviteId = typeof CoachOnboardingInviteId.Type

/**
 * The invite's own lifecycle, deliberately separate from provisioning and from
 * onboarding completion (#112). `accepted` is the exclusive claim taken by the
 * first valid `/start`: it never auto-expires, so the seven-day TTL only ever
 * applies to a `pending` invite. `used` is set when the coach bot connects.
 */
export const CoachOnboardingInviteStatus = Schema.Literals([
  "pending",
  "accepted",
  "used",
  "expired",
  "cancelled",
])
export type CoachOnboardingInviteStatus = typeof CoachOnboardingInviteStatus.Type

/**
 * Why a still-claimable invite was cancelled. Terminal in every case — the old
 * code never resolves again. `reset_by_admin` and `reissued` differ only in
 * whether a replacement invite was minted in the same gesture.
 */
export const CoachOnboardingInviteCancellationReason = Schema.Literals([
  "declined_by_coach",
  "reset_by_admin",
  "reissued",
])
export type CoachOnboardingInviteCancellationReason =
  typeof CoachOnboardingInviteCancellationReason.Type

/**
 * The public start-param code carried by `t.me/{bot}?start=ws_{code}`. A base32
 * alphabet that drops the visually ambiguous `0 O 1 I` (Crockford already omits
 * `O`/`I`; we also drop `0`/`1`), so a coach can read it off a screen without
 * mistyping. 30 symbols over 8 slots (~6.5e11 codes) keeps the link short while
 * leaving guessing infeasible; uniqueness is enforced by the
 * `coach_onboarding_invite.code` column, not by the alphabet.
 */
export const CoachOnboardingInviteCodeAlphabet = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
export const CoachOnboardingInviteCodeLength = 8
/** The cheap pre-DB junk filter: exactly 8 symbols from the code alphabet. */
export const CoachOnboardingInviteCodePattern = new RegExp(
  `^[${CoachOnboardingInviteCodeAlphabet}]{${CoachOnboardingInviteCodeLength}}$`,
)

export const CoachOnboardingInviteCode = Schema.NonEmptyString.pipe(
  Schema.brand("CoachOnboardingInviteCode"),
)
export type CoachOnboardingInviteCode = typeof CoachOnboardingInviteCode.Type
