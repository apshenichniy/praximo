import { formatExpiresIn, formatRelativeTime, statusLabel } from "@/features/admin/formatting.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"
import type { ViewerRole } from "@/server/viewer-role.ts"

/**
 * How urgently a row wants attention. Amber is something the admin can still
 * push forward, sky is progress that is now the coach's move, emerald is
 * healthy, rose is broken, muted is terminal history. `expired` is amber rather
 * than rose — a lapsed invite is routine and fixed by reissuing.
 */
export type CoachStateTone = "amber" | "sky" | "emerald" | "rose" | "muted"

export interface CoachRowState {
  readonly label: string
  readonly tone: CoachStateTone
}

const onboardingStates = {
  invited: { label: "Invited", tone: "amber" },
  accepted: { label: "Accepted", tone: "sky" },
  stalled: { label: "Setup stalled", tone: "amber" },
  "bot-connected": { label: "Awaiting activation", tone: "sky" },
  expired: { label: "Invite expired", tone: "amber" },
  declined: { label: "Declined", tone: "muted" },
  reset: { label: "Reset", tone: "muted" },
  "not-invited": { label: "No invite", tone: "muted" },
} as const satisfies Record<AdminSurface.CoachOnboardingStage, CoachRowState>

const botTones = {
  "awaiting-setup": "amber",
  connected: "emerald",
  "needs-relink": "rose",
} as const satisfies Record<AdminSurface.CoachListEntry["botStatus"], CoachStateTone>

/**
 * The state word for a coach, wherever they are shown. A coach who finished
 * onboarding is described by their bot's connection; everyone else by where
 * they stand on the invite lifecycle. The word carries the whole state on its
 * own — the tone only makes it faster to find, so it still reads correctly with
 * the colour ignored.
 *
 * The list and the details header both call this, so the two surfaces cannot
 * end up naming the same state differently.
 */
export const stageState = (
  stage: AdminSurface.CoachOnboardingStage | undefined,
  botStatus: AdminSurface.CoachListEntry["botStatus"],
): CoachRowState =>
  stage === undefined
    ? { label: statusLabel[botStatus], tone: botTones[botStatus] }
    : onboardingStates[stage]

/**
 * A deletion in flight outranks every other state (#110): the row's own future
 * is being removed, so where the coach stood on onboarding stopped mattering
 * the moment it started. Rose rather than muted — an interrupted deletion is
 * the one row on this screen that wants a hand.
 */
export const coachRowState = (coach: AdminSurface.CoachListEntry): CoachRowState =>
  coach.deleting === true
    ? { label: "Deleting…", tone: "rose" }
    : stageState(coach.onboarding?.stage, coach.botStatus)

const relative = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : formatRelativeTime(value)

const prefixed = (noun: string, value: string | undefined): string | undefined =>
  value === undefined ? undefined : `${noun} ${formatRelativeTime(value)}`

/**
 * The one timestamp that follows the state word: always the time of the thing
 * the state names, and never a countdown once the invite has been accepted —
 * acceptance retires the seven-day TTL (#112), so a ticking number beside it
 * would read as a deadline the coach does not actually have.
 *
 * The state word supplies the noun, so most of these are a bare relative time.
 * Only where the word and the timestamp describe different events does the
 * timestamp name its own.
 */
export const coachRowTime = (coach: AdminSurface.CoachListEntry): string | undefined => {
  // A deleting row has one thing to say and a Resume beside it; a timestamp
  // from the life the workspace is losing would only compete with both.
  if (coach.deleting === true) return undefined
  const onboarding = coach.onboarding
  if (onboarding === undefined) {
    return coach.lastActivityAt === undefined
      ? "no activity yet"
      : `active ${formatRelativeTime(coach.lastActivityAt)}`
  }

  switch (onboarding.stage) {
    case "invited":
      return onboarding.expiresAt === undefined ? undefined : formatExpiresIn(onboarding.expiresAt)
    case "accepted":
      return relative(onboarding.acceptedAt)
    case "stalled":
    case "bot-connected":
      return prefixed("accepted", onboarding.acceptedAt)
    case "expired":
      return relative(onboarding.expiresAt)
    case "declined":
    case "reset":
      return relative(onboarding.cancelledAt)
    case "not-invited":
      return undefined
  }
}

/** The contextual action an admin who is also a coach gets on their own row. */
export const viewerCoachAction = (
  viewerCoach: ViewerRole.ViewerCoach,
): { readonly title: string; readonly subtitle: string } =>
  viewerCoach.state === "active"
    ? { title: "Open my coach bot", subtitle: "Your own workspace lives in your bot" }
    : {
        title: "Continue my coach setup",
        subtitle:
          viewerCoach.state === "accepted"
            ? "Pick up where you left off in the manager chat"
            : "Open your bot to finish activating your workspace",
      }
