import { channelLabel, formatExpiresIn, formatRelativeTime } from "@/features/admin/formatting.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

export type WorkspaceDetail = AdminSurface.WorkspaceDetail
export type DetailInvite = NonNullable<WorkspaceDetail["invite"]>

/**
 * Which of the two details screens a workspace gets (#108). The server already
 * decided: a coach with no onboarding stage has finished onboarding, and that
 * is the same signal the list uses to stop pinning their row.
 */
export const detailVariant = (workspace: WorkspaceDetail): "onboarding" | "active" =>
  workspace.onboarding === undefined ? "active" : "onboarding"

/**
 * The headline of the invite card, one line per lifecycle stage. Two rules hold
 * across all of them: the timestamp always names the event the title names, and
 * an accepted claim never shows a countdown — acceptance retires the seven-day
 * TTL (#112), so a deadline there would be a lie.
 */
export interface InviteHeadline {
  readonly title: string
  readonly detail: string
  /** Matches the list row's tone vocabulary, so both surfaces read alike. */
  readonly tone: "amber" | "sky" | "emerald" | "muted"
}

const since = (value: string | undefined, fallback: string): string =>
  value === undefined ? fallback : formatRelativeTime(value)

export const inviteHeadline = (workspace: WorkspaceDetail): InviteHeadline => {
  const invite = workspace.invite
  switch (workspace.onboarding) {
    case "invited":
      return {
        title: "Invite sent",
        detail:
          invite?.expiresAt === undefined
            ? "The link is live and single-use."
            : `The link is live and ${formatExpiresIn(invite.expiresAt)}.`,
        tone: "amber",
      }
    case "accepted":
      return {
        title: "Link opened",
        detail: `The coach claimed this invite ${since(invite?.acceptedAt, "recently")} and is setting up their bot. The link no longer expires.`,
        tone: "sky",
      }
    case "stalled":
      return {
        title: "Setup stalled",
        detail: `Opened ${since(invite?.acceptedAt, "over a day ago")} and still unfinished. The claim is held — reset it below to hand the workspace to someone else.`,
        tone: "amber",
      }
    case "bot-connected":
      return {
        title: "Bot connected",
        detail:
          "The coach's bot is live. Onboarding completes when they sign in and accept the terms.",
        tone: "sky",
      }
    case "expired":
      return {
        title: "Invite expired",
        detail: `The link lapsed ${since(invite?.expiresAt, "some time ago")} without being opened.`,
        tone: "muted",
      }
    case "declined":
      return {
        title: "Invite declined",
        detail: `The coach declined ${since(invite?.cancelledAt, "earlier")}. Issue a new link if that was a mistake.`,
        tone: "muted",
      }
    case "reset":
      return {
        title: "Invite reset",
        detail: `Reset ${since(invite?.cancelledAt, "earlier")}. The old link no longer works.`,
        tone: "muted",
      }
    default:
      return {
        title: "No invite yet",
        detail:
          "This workspace has never been invited. Delete it, or invite a coach from the list.",
        tone: "muted",
      }
  }
}

/**
 * The one line under the coach's name. It reports whether onboarding is moving,
 * has stopped, or never started — a distinction "Onboarding in progress" would
 * paper over on a workspace nobody has actually been invited to.
 */
export const detailSubtitle = (workspace: WorkspaceDetail): string => {
  switch (workspace.onboarding) {
    case undefined:
      return "Active coach"
    case "not-invited":
      return "No invite yet"
    case "expired":
    case "declined":
    case "reset":
      return "Onboarding stopped"
    default:
      return "Onboarding in progress"
  }
}

export type StepState = "done" | "current" | "upcoming" | "blocked"

export interface OnboardingStep {
  readonly title: string
  readonly description: string
  readonly state: StepState
}

const stepTexts = [
  {
    title: "Coach opens the invite",
    description: "The single-use link claims this workspace for whoever opens it first.",
  },
  {
    title: "Telegram creates their bot",
    description: "One tap in the manager chat; Praximo connects and brands the new bot.",
  },
  {
    title: "Coach signs in and accepts the terms",
    description: "The last step — after it the workspace is live and leaves this screen.",
  },
] as const

/**
 * "What happens next", mirroring the coach's own onboarding (ADR 0004). The
 * three steps are always all shown: the admin's question is as often "how far
 * is this going to go" as "where is it stuck", and a list that hides the future
 * answers only the second. A terminal invite blocks step one rather than
 * marking it upcoming — nothing progresses until a new link is issued.
 */
export const onboardingSteps = (workspace: WorkspaceDetail): ReadonlyArray<OnboardingStep> => {
  const states = ((): readonly [StepState, StepState, StepState] => {
    switch (workspace.onboarding) {
      case "invited":
        return ["current", "upcoming", "upcoming"]
      case "accepted":
      case "stalled":
        return ["done", "current", "upcoming"]
      case "bot-connected":
        return ["done", "done", "current"]
      default:
        return ["blocked", "upcoming", "upcoming"]
    }
  })()

  return stepTexts.map((step, index) => ({
    title: step.title,
    description: step.description,
    state: states[index] ?? "upcoming",
  }))
}

/**
 * Reset/reissue is always explicit and always confirmed. Resetting an accepted
 * claim is the one case that takes something away from a coach who already
 * started, so it says so rather than hiding behind "re-issue" (#107).
 */
export interface ReissueCopy {
  readonly label: string
  readonly title: string
  readonly description: string
  /**
   * Whether the reissue takes something away. Against a live or accepted invite
   * it does, and belongs in the danger zone; against an invite that is already
   * dead it only restores a way forward, and burying that under a red heading
   * would misname the safest action on the screen.
   */
  readonly destructive: boolean
}

export const reissueCopy = (workspace: WorkspaceDetail): ReissueCopy => {
  switch (workspace.onboarding) {
    case "accepted":
    case "stalled":
      return {
        label: "Reset setup",
        title: "Reset this coach's setup?",
        description:
          "Their claim is released and the link they already opened stops working. They will need the new link to start over.",
        destructive: true,
      }
    case "expired":
    case "declined":
    case "reset":
      return {
        label: "Issue a new link",
        title: "Issue a new onboarding link?",
        description: "A fresh single-use link is created, valid for another 7 days.",
        destructive: false,
      }
    default:
      return {
        label: "Reset invite",
        title: "Reset the onboarding invite?",
        description: "The current link stops working immediately and is replaced by a new one.",
        destructive: true,
      }
  }
}

/** How the invite reached the coach, as a standalone value rather than a phrase. */
export const inviteChannel = (invite: DetailInvite | undefined): string =>
  invite?.channel === undefined ? "Not recorded" : channelLabel[invite.channel]
