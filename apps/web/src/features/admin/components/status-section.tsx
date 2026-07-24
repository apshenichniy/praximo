import type { ReactNode } from "react"

import { Card } from "@/components/ui/card.tsx"
import { Section, SectionTitle } from "@/features/admin/components/section.tsx"
import { StatusBadge } from "@/features/admin/components/status-badge.tsx"
import { formatRelativeTime, formatTimestamp, languageLabel } from "@/features/admin/formatting.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

function StatusRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-5 px-5 py-3">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  )
}

/** Relative time first, absolute date beneath — or the empty label. */
function TimestampValue({
  value,
  empty,
}: {
  readonly value: string | undefined
  readonly empty: string
}) {
  if (value === undefined) return empty
  return (
    <span className="flex flex-col items-end">
      <span>{formatRelativeTime(value)}</span>
      <span className="text-muted-foreground text-xs font-normal">
        {formatTimestamp(value, "")}
      </span>
    </span>
  )
}

export function StatusSection({ workspace }: { readonly workspace: AdminSurface.WorkspaceDetail }) {
  return (
    <Section aria-labelledby="status-heading">
      <SectionTitle id="status-heading">Status</SectionTitle>
      <Card className="mt-4 gap-0 overflow-hidden py-0">
        <dl className="divide-border divide-y">
          <StatusRow label="Bot connection">
            <StatusBadge status={workspace.botStatus} />
          </StatusRow>
          <StatusRow label="Coach language">
            {workspace.coachLanguage === undefined
              ? "Unknown"
              : languageLabel[workspace.coachLanguage]}
          </StatusRow>
          <StatusRow label="Bot username">
            {workspace.botUsername === undefined ? "Not connected" : `@${workspace.botUsername}`}
          </StatusRow>
          <StatusRow label="Terms">
            {workspace.termsAcceptedAt === undefined ? "Not accepted" : "Accepted"}
          </StatusRow>
          <StatusRow label="Invited">
            <TimestampValue value={workspace.invite?.issuedAt} empty="Not invited" />
          </StatusRow>
          <StatusRow label="Created">
            <TimestampValue value={workspace.createdAt} empty="Unknown" />
          </StatusRow>
          <StatusRow label="Last login">
            <TimestampValue value={workspace.lastLoginAt} empty="Never" />
          </StatusRow>
          <StatusRow label="Last activity">
            <TimestampValue value={workspace.lastActivityAt} empty="Never" />
          </StatusRow>
        </dl>
      </Card>
    </Section>
  )
}
