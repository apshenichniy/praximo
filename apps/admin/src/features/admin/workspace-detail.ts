import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  HourglassIcon,
  ProgressIcon,
  SentIcon,
} from "@hugeicons-pro/core-stroke-rounded"
import type { IconSvgElement } from "@hugeicons/react"

import { type CoachStateTone, stageState } from "@/features/admin/coach-progress.ts"
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

const since = (value: string | undefined, fallback: string): string =>
  value === undefined ? fallback : formatRelativeTime(value)

/**
 * What the invite card says in prose. It deliberately carries no title of its
 * own: the header already names the state in one word, and repeating that word
 * directly underneath would read as two statuses rather than one explained.
 *
 * One rule holds across every stage — an accepted claim never shows a countdown,
 * because acceptance retires the seven-day TTL (#112) and a deadline there
 * would be a lie.
 */
export const inviteExplanation = (workspace: WorkspaceDetail): string => {
  const invite = workspace.invite
  switch (workspace.onboarding) {
    case "invited":
      return invite?.expiresAt === undefined
        ? "The link is live and single-use."
        : `The link is live and ${formatExpiresIn(invite.expiresAt)}.`
    case "accepted":
      return `The coach claimed this invite ${since(invite?.acceptedAt, "recently")} and is setting up their bot. The link no longer expires.`
    case "stalled":
      return `Opened ${since(invite?.acceptedAt, "over a day ago")} and still unfinished. The claim is held — reset it below to hand the workspace to someone else.`
    case "bot-connected":
      return "The coach's bot is live. Onboarding completes when they sign in and accept the terms."
    case "expired":
      return `The link lapsed ${since(invite?.expiresAt, "some time ago")} without being opened.`
    case "declined":
      return `The coach declined ${since(invite?.cancelledAt, "earlier")}. Issue a new link if that was a mistake.`
    case "reset":
      return `Reset ${since(invite?.cancelledAt, "earlier")}. The old link no longer works.`
    default:
      return "This workspace has never been invited. Delete it, or invite a coach from the list."
  }
}

/**
 * The status line under the coach's name. Its word and tone come from the same
 * vocabulary the list rows use, so a coach cannot be called one thing on the
 * list and another on their own screen; the icon is added here because a
 * details header is a focal element, where a list is a scanning surface.
 */
export interface DetailStatus {
  readonly label: string
  readonly tone: CoachStateTone
  readonly icon: IconSvgElement
}

const stageIcon = {
  invited: SentIcon,
  accepted: ProgressIcon,
  stalled: HourglassIcon,
  "bot-connected": ProgressIcon,
  expired: Clock01Icon,
  declined: Alert02Icon,
  reset: Alert02Icon,
  "not-invited": Alert02Icon,
} as const satisfies Record<AdminSurface.CoachOnboardingStage, IconSvgElement>

const botStatusIcon = {
  "awaiting-setup": HourglassIcon,
  connected: CheckmarkCircle02Icon,
  "needs-relink": Alert02Icon,
} as const satisfies Record<WorkspaceDetail["botStatus"], IconSvgElement>

export const detailStatus = (workspace: WorkspaceDetail): DetailStatus => {
  const stage = workspace.onboarding
  return {
    ...stageState(stage, workspace.botStatus),
    icon: stage === undefined ? botStatusIcon[workspace.botStatus] : stageIcon[stage],
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
