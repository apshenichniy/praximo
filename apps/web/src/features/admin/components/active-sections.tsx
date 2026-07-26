import {
  DetailCard,
  DetailRow,
  PlaceholderValue,
  TimestampValue,
} from "@/features/mini-app/components/detail-card.tsx"
import { Section, SectionTitle } from "@/features/mini-app/components/section.tsx"
import { StatusBadge } from "@/features/admin/components/status-badge.tsx"
import { languageLabel } from "@/features/admin/formatting.ts"
import type { WorkspaceDetail } from "@/features/admin/workspace-detail.ts"

/**
 * Status first (#108): an active coach's screen opens with the two things that
 * can actually go wrong — the bot's connection and whether the coach is still
 * showing up — rather than with settings nobody edits twice.
 *
 * `Needs re-link` is display-only until detection ships (#55); nothing here
 * offers a repair the product cannot yet perform.
 */
export function CoachStatusSection({ workspace }: { readonly workspace: WorkspaceDetail }) {
  return (
    <Section className="mt-10" aria-labelledby="status-heading">
      <SectionTitle id="status-heading">Status</SectionTitle>
      <DetailCard>
        <DetailRow label="Bot connection">
          <StatusBadge status={workspace.botStatus} />
        </DetailRow>
        <DetailRow label="Last activity">
          <TimestampValue value={workspace.lastActivityAt} empty="No activity yet" />
        </DetailRow>
        <DetailRow label="Last login">
          <TimestampValue value={workspace.lastLoginAt} empty="Never" />
        </DetailRow>
        <DetailRow label="Terms accepted">
          <TimestampValue value={workspace.termsAcceptedAt} empty="Not accepted" />
        </DetailRow>
      </DetailCard>
    </Section>
  )
}

export function AboutSection({ workspace }: { readonly workspace: WorkspaceDetail }) {
  return (
    <Section aria-labelledby="about-heading">
      <SectionTitle id="about-heading">About</SectionTitle>
      <DetailCard>
        <DetailRow label="Coach language">
          {workspace.coachLanguage === undefined ? (
            <span className="text-muted-foreground font-normal">Not set yet</span>
          ) : (
            languageLabel[workspace.coachLanguage]
          )}
        </DetailRow>
        <DetailRow label="Joined">
          <TimestampValue value={workspace.joinedAt} empty="Not yet" />
        </DetailRow>
        <DetailRow label="Workspace created">
          <TimestampValue value={workspace.createdAt} empty="Unknown" />
        </DetailRow>
      </DetailCard>
    </Section>
  )
}

/**
 * Practice aggregates are deliberately not built yet (#113). The placeholders
 * are italic em dashes rather than zeros: "0 clients" is a claim about the
 * coach, "—" is a claim about us, and only the second one is true today.
 */
export function PracticeSection() {
  return (
    <Section aria-labelledby="practice-heading">
      <SectionTitle id="practice-heading">Practice</SectionTitle>
      <DetailCard>
        <DetailRow label="Clients">
          <PlaceholderValue>Not tracked yet</PlaceholderValue>
        </DetailRow>
        <DetailRow label="Sessions">
          <PlaceholderValue>Not tracked yet</PlaceholderValue>
        </DetailRow>
      </DetailCard>
      <p className="text-muted-foreground mt-3 px-1 text-caption leading-5">
        Client and session counts arrive with practice aggregates.
      </p>
    </Section>
  )
}
