import { AddCircleIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
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
import { StatusBadge } from "@/features/admin/components/status-badge.tsx"
import { WorkspaceAvatar } from "@/features/admin/components/workspace-avatar.tsx"
import { type BotStatus, displayName } from "@/features/admin/formatting.ts"

export interface WorkspaceListEntry {
  readonly id: string
  readonly name: string
  readonly botStatus: BotStatus
  readonly botUsername?: string
}

/** Flush list surface: the create action and workspace rows divide it. */
export function WorkspaceListCard({ children }: { readonly children: ReactNode }) {
  return <Card className="divide-border gap-0 divide-y overflow-hidden py-0">{children}</Card>
}

export function CreateWorkspaceLink() {
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

export function WorkspaceListItem({ workspace }: { readonly workspace: WorkspaceListEntry }) {
  return (
    <Item
      render={<Link to="/admin/workspaces/$workspaceId" params={{ workspaceId: workspace.id }} />}
      className="active:bg-accent/70 min-h-[78px] rounded-none border-0"
    >
      <ItemMedia>
        <WorkspaceAvatar name={workspace.name} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full text-base font-semibold">
          <span className="truncate">{displayName(workspace.name)}</span>
          <StatusBadge status={workspace.botStatus} />
        </ItemTitle>
        {workspace.botUsername === undefined ? null : (
          <ItemDescription className="truncate">@{workspace.botUsername}</ItemDescription>
        )}
      </ItemContent>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        size={20}
        strokeWidth={2}
        className="text-muted-foreground/60 shrink-0"
      />
    </Item>
  )
}

export function WorkspaceListEmpty() {
  return (
    <Empty className="border-0 p-10">
      <EmptyHeader>
        <EmptyTitle>No coaches yet</EmptyTitle>
        <EmptyDescription>Invited coaches will appear here.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/admin/workspaces/new" />}>Invite a coach</Button>
      </EmptyContent>
    </Empty>
  )
}

export function WorkspaceListNoMatches({
  query,
  onClear,
}: {
  readonly query: string
  readonly onClear: () => void
}) {
  return (
    <Empty className="border-0 p-10">
      <EmptyHeader>
        <EmptyTitle>No workspaces match “{query}”</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="link" onClick={onClear}>
          Clear search
        </Button>
      </EmptyContent>
    </Empty>
  )
}
