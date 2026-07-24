import {
  AddCircleIcon,
  ArrowRight01Icon,
  Copy01Icon,
  TelegramIcon,
  UserSharingIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button.tsx"
import { Card } from "@/components/ui/card.tsx"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty.tsx"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { onboardingDescription, viewerCoachAction } from "@/features/admin/coach-progress.ts"
import { CoachStageBadge } from "@/features/admin/components/coach-stage-badge.tsx"
import { StatusBadge } from "@/features/admin/components/status-badge.tsx"
import { WorkspaceAvatar } from "@/features/admin/components/workspace-avatar.tsx"
import { displayName, formatRelativeTime } from "@/features/admin/formatting.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

export type CoachEntry = AdminSurface.CoachListEntry

/** Flush list surface: the create action and coach rows divide it. */
export function CoachListCard({ children }: { readonly children: ReactNode }) {
  return <Card className="divide-border gap-0 divide-y overflow-hidden py-0">{children}</Card>
}

export function InviteCoachLink() {
  return (
    <Link
      to="/admin/workspaces/new"
      className="text-primary hover:bg-muted active:bg-accent/70 flex min-h-[70px] w-full items-center gap-4 px-4 text-left font-medium transition-colors"
    >
      <span className="border-primary/50 flex size-11 items-center justify-center rounded-full border">
        <HugeiconsIcon icon={AddCircleIcon} size={25} strokeWidth={1.8} />
      </span>
      Invite a coach
    </Link>
  )
}

function CoachRowLink({
  coach,
  badge,
  description,
}: {
  readonly coach: CoachEntry
  readonly badge: ReactNode
  readonly description: ReactNode
}) {
  return (
    <Item
      render={<Link to="/admin/workspaces/$workspaceId" params={{ workspaceId: coach.id }} />}
      className="active:bg-accent/70 min-h-[78px] items-start rounded-none border-0 pt-4"
    >
      <ItemMedia>
        <WorkspaceAvatar name={coach.name} />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-1.5">
        <ItemTitle className="max-w-full text-base font-semibold">
          <span className="truncate">{displayName(coach.name)}</span>
          {badge}
        </ItemTitle>
        {description}
      </ItemContent>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        size={20}
        strokeWidth={2}
        className="text-muted-foreground/60 mt-1 shrink-0"
      />
    </Item>
  )
}

/**
 * A coach whose onboarding is still incomplete. The row stays tappable through
 * to the details page; Resend and Copy sit outside the link so the whole card
 * is not one nested-interactive anchor.
 */
export function OnboardingCoachItem({
  coach,
  onResend,
  onCopy,
  resending,
  copied,
}: {
  readonly coach: CoachEntry
  readonly onResend: (coach: CoachEntry) => void
  readonly onCopy: (coach: CoachEntry) => void
  readonly resending: boolean
  readonly copied: boolean
}) {
  const onboarding = coach.onboarding
  if (onboarding === undefined) return null

  return (
    <div>
      <CoachRowLink
        coach={coach}
        badge={<CoachStageBadge stage={onboarding.stage} />}
        description={
          <ItemDescription className="text-[13px] leading-5">
            {onboardingDescription(onboarding)}
          </ItemDescription>
        }
      />
      {onboarding.actions === undefined ? null : (
        <div className="flex gap-2 px-4 pb-4 pl-[4.75rem]">
          <Button
            variant="outline"
            size="sm"
            disabled={resending}
            aria-busy={resending || undefined}
            className="h-9 flex-1 font-medium"
            onClick={() => onResend(coach)}
          >
            {resending ? (
              <>
                <Spinner /> Sending…
              </>
            ) : (
              <>
                <HugeiconsIcon icon={TelegramIcon} size={16} strokeWidth={1.8} />
                Resend
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 flex-1 font-medium"
            onClick={() => onCopy(coach)}
          >
            <HugeiconsIcon icon={Copy01Icon} size={16} strokeWidth={1.8} />
            {copied ? "Copied" : "Copy invite"}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * An onboarded coach. The practice counts are deliberate placeholders until the
 * aggregates land (#113) — em dashes, not zeros, so an empty practice and an
 * unbuilt metric never look alike.
 */
export function ActiveCoachItem({ coach }: { readonly coach: CoachEntry }) {
  return (
    <CoachRowLink
      coach={coach}
      badge={<StatusBadge status={coach.botStatus} />}
      description={
        <>
          <ItemDescription className="truncate text-[13px] leading-5">
            {coach.botUsername === undefined ? "Bot username pending" : `@${coach.botUsername}`}
          </ItemDescription>
          <ItemDescription className="text-[13px] leading-5">
            {coach.lastActivityAt === undefined
              ? "No activity yet"
              : `active ${formatRelativeTime(coach.lastActivityAt)}`}
          </ItemDescription>
          <p className="text-muted-foreground/45 text-xs" title="Practice counts are not built yet">
            &mdash; clients &middot; &mdash; sessions
          </p>
        </>
      }
    />
  )
}

export function CoachListEmpty() {
  return (
    <Empty className="border-0 p-10">
      <EmptyHeader>
        <EmptyTitle>No coaches yet</EmptyTitle>
        <EmptyDescription>
          Invite your first coach — they appear here the moment the invite goes out.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/admin/workspaces/new" />}>Invite a coach</Button>
      </EmptyContent>
    </Empty>
  )
}

/**
 * The contextual action for an admin who is also a coach (#107). It sits above
 * the list rather than routing anywhere new: the admin's entry flow is
 * unchanged, they simply get their own workspace one tap away.
 */
export function ViewerCoachCard({
  viewerCoach,
  onOpen,
}: {
  readonly viewerCoach: AdminSurface.ViewerCoach
  readonly onOpen: (link: string) => void
}) {
  const action = viewerCoachAction(viewerCoach)
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Item
        render={<button type="button" onClick={() => onOpen(viewerCoach.link)} />}
        className="hover:bg-muted active:bg-accent/70 min-h-[70px] w-full rounded-none border-0 text-left transition-colors"
      >
        <ItemMedia>
          <span className="border-primary/50 text-primary flex size-11 items-center justify-center rounded-full border">
            <HugeiconsIcon icon={UserSharingIcon} size={22} strokeWidth={1.8} />
          </span>
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="font-medium">{action.title}</ItemTitle>
          <ItemDescription className="text-xs leading-4">{action.subtitle}</ItemDescription>
        </ItemContent>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={20}
          strokeWidth={2}
          className="text-muted-foreground/60 shrink-0"
        />
      </Item>
    </Card>
  )
}
