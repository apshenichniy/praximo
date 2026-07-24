import { channelLabel, formatExpiresIn, formatRelativeTime } from "@/features/admin/formatting.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

/** " 2 hours ago", or nothing at all when the timestamp is missing. */
const since = (value: string | undefined): string =>
  value === undefined ? "" : ` ${formatRelativeTime(value)}`

/**
 * The single line under a pinned coach's name. It says where the invite went,
 * what has happened since, and — only while the invite is still `pending` — how
 * long is left. An accepted claim never shows a countdown: acceptance retires
 * the TTL, and a ticking number next to it would read as a deadline the coach
 * does not actually have (#112).
 */
export const onboardingDescription = (onboarding: AdminSurface.CoachOnboarding): string => {
  switch (onboarding.stage) {
    case "invited": {
      const via =
        onboarding.channel === undefined
          ? "Invited"
          : `Invited via ${channelLabel[onboarding.channel]}`
      return onboarding.expiresAt === undefined
        ? via
        : `${via} · ${formatExpiresIn(onboarding.expiresAt)}`
    }
    case "accepted":
      return `Accepted${since(onboarding.acceptedAt)} · setup in progress`
    case "stalled":
      return `Accepted${since(onboarding.acceptedAt)} · still incomplete`
    case "bot-connected":
      return "Bot connected · waiting for first login and terms"
    case "expired":
      return onboarding.expiresAt === undefined
        ? "The invite reached its expiry"
        : `Expired${since(onboarding.expiresAt)}`
    case "declined":
      return `Invitation declined${since(onboarding.cancelledAt)}`
    case "reset":
      return `Invitation reset${since(onboarding.cancelledAt)}`
    case "not-invited":
      return "No invite has been issued"
  }
}

/** The contextual action an admin who is also a coach gets on their own row. */
export const viewerCoachAction = (
  viewerCoach: AdminSurface.ViewerCoach,
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
