import { Schema } from "effect"

export const CoachOnboardingInviteId = Schema.NonEmptyString.pipe(
  Schema.brand("CoachOnboardingInviteId"),
)
export type CoachOnboardingInviteId = typeof CoachOnboardingInviteId.Type

export const CoachOnboardingInviteStatus = Schema.Literals(["pending", "used", "expired"])
export type CoachOnboardingInviteStatus = typeof CoachOnboardingInviteStatus.Type

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
