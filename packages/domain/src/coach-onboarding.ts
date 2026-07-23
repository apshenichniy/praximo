import { Schema } from "effect"

export const CoachOnboardingInviteId = Schema.NonEmptyString.pipe(
  Schema.brand("CoachOnboardingInviteId"),
)
export type CoachOnboardingInviteId = typeof CoachOnboardingInviteId.Type

export const CoachOnboardingInviteStatus = Schema.Literals(["pending", "used", "expired"])
export type CoachOnboardingInviteStatus = typeof CoachOnboardingInviteStatus.Type
