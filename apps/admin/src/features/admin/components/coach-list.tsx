import { ArrowRight01Icon, UserSharingIcon } from "@hugeicons/core-free-icons"
import { AddMaleIcon } from "@hugeicons-pro/core-stroke-rounded"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { Card } from "@praximo/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@praximo/ui/components/empty"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@praximo/ui/components/item"
import {
  type CoachStateTone,
  coachRowState,
  coachRowTime,
  viewerCoachAction,
} from "@/features/admin/coach-progress.ts"
import { WorkspaceAvatar } from "@/features/admin/components/workspace-avatar.tsx"
import { displayName } from "@/features/admin/formatting.ts"
import { cn } from "@praximo/ui"
import type { AdminSurface } from "@/server/admin-surface.ts"
import type { ViewerRole } from "@/server/viewer-role.ts"

export type CoachEntry = AdminSurface.CoachListEntry

/** Flush list surface: the create action and coach rows divide it. */
export function CoachListCard({ children }: { readonly children: ReactNode }) {
  return <Card className="divide-border gap-0 divide-y overflow-hidden py-0">{children}</Card>
}

export function InviteCoachLink() {
  return (
    <Link
      to="/admin/workspaces/new"
      className="text-primary transition-colors duration-100 active:bg-muted hover:bg-muted flex h-16 w-full items-center gap-3.5 px-4 text-left font-semibold"
    >
      <span className="border-primary/30 text-primary flex size-[38px] items-center justify-center rounded-full border">
        <HugeiconsIcon icon={AddMaleIcon} size={22} strokeWidth={1.8} />
      </span>
      Invite a coach
    </Link>
  )
}

const toneClass = {
  warning: "text-warning",
  info: "text-info",
  success: "text-success",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
} as const satisfies Record<CoachStateTone, string>

const dotClass = {
  warning: "bg-warning",
  info: "bg-info",
  success: "bg-success",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/60",
} as const satisfies Record<CoachStateTone, string>

/**
 * One row shape for every coach, onboarding or active, at one fixed height — a
 * scanning surface reads faster when nothing about a row's size means anything.
 *
 * The state is a coloured word rather than a badge — **in a row**. Narrowed in
 * #198, which put a badge in the two heroes: the original rule said a badge
 * would be the only element carrying its own fill, and that was already untrue
 * on this screen, where `StatusBadge` ships in the sections below. What survives
 * is the part about scanning. A list is read by running an eye down it, and a
 * fill and a radius in every row is a shape to parse in every row; a hero has
 * one subject and one state and nothing competing, so there the word read as a
 * third paragraph instead of as the coach's standing.
 *
 * So: **badge in a hero, word in a row.** Weight does the rest here — the name
 * leads on size, the state word is the only semibold thing in the meta line, and
 * the timestamp sits behind it at normal weight.
 */
export function CoachRow({ coach }: { readonly coach: CoachEntry }) {
  const state = coachRowState(coach)
  const time = coachRowTime(coach)
  const deleting = coach.deleting === true

  return (
    <Item
      render={<Link to="/admin/workspaces/$workspaceId" params={{ workspaceId: coach.id }} />}
      className="transition-colors duration-100 active:bg-muted h-16 gap-3.5 rounded-none border-0 px-4 py-0"
    >
      <ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
        <WorkspaceAvatar
          name={coach.name}
          className={cn("size-[38px]", deleting && "opacity-45 grayscale")}
        />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="block truncate">{displayName(coach.name)}</ItemTitle>
        <ItemDescription className="flex min-w-0 items-center">
          <span
            aria-hidden="true"
            className={cn("mr-[7px] size-1.5 shrink-0 rounded-full", dotClass[state.tone])}
          />
          <span className={cn("shrink-0 font-semibold", toneClass[state.tone])}>{state.label}</span>
          {time === undefined ? null : (
            // The gap is a margin, not a leading space: JSX would collapse the
            // space and leave the separator glued to the state word.
            <span className="text-muted-foreground ml-1.5 truncate font-normal">{`· ${time}`}</span>
          )}
        </ItemDescription>
      </ItemContent>
      {deleting ? (
        // An interrupted deletion is the one row that names its own action
        // (#110). It is still the same link — the workspace screen owns the
        // pipeline, as it owns every other action on a coach — but the row says
        // what is waiting there rather than leaving it to a chevron.
        <span className="border-destructive/40 text-destructive shrink-0 rounded-full border px-3 py-1 text-xs leading-normal font-semibold">
          Resume
        </span>
      ) : (
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={20}
          strokeWidth={2}
          className="text-muted-foreground/60 shrink-0"
        />
      )}
    </Item>
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
  readonly viewerCoach: ViewerRole.ViewerCoach
  readonly onOpen: (link: string) => void
}) {
  const action = viewerCoachAction(viewerCoach)
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Item
        render={<button type="button" onClick={() => onOpen(viewerCoach.link)} />}
        className="transition-colors duration-100 active:bg-muted hover:bg-muted w-full gap-3.5 rounded-none border-0 px-4 text-left transition-colors"
      >
        <ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
          <span className="border-primary/30 text-primary flex size-[38px] items-center justify-center rounded-full border">
            <HugeiconsIcon icon={UserSharingIcon} size={20} strokeWidth={1.8} />
          </span>
        </ItemMedia>
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle>{action.title}</ItemTitle>
          <ItemDescription>{action.subtitle}</ItemDescription>
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
