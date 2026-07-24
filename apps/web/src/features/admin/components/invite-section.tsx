import { Copy01Icon, TelegramIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button.tsx"
import { Card, CardContent } from "@/components/ui/card.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { DetailCard, DetailRow, TimestampValue } from "@/features/admin/components/detail-card.tsx"
import { InviteLinkPanel } from "@/features/admin/components/invite-link-panel.tsx"
import { Section, SectionTitle } from "@/features/admin/components/section.tsx"
import { formatExpiresIn } from "@/features/admin/formatting.ts"
import { useCopyLink } from "@/features/admin/hooks/use-copy-link.ts"
import {
  inviteChannel,
  inviteHeadline,
  type WorkspaceDetail,
} from "@/features/admin/workspace-detail.ts"
import { cn } from "@/lib/utils.ts"

const toneClass = {
  amber: "text-amber-300",
  sky: "text-sky-300",
  emerald: "text-emerald-300",
  muted: "text-muted-foreground",
} as const

const dotClass = {
  amber: "bg-amber-300",
  sky: "bg-sky-300",
  emerald: "bg-emerald-300",
  muted: "bg-muted-foreground/60",
} as const

/**
 * The pending screen's centrepiece: where this invite stands, what it is made
 * of, and the two ways to get it in front of the coach again.
 *
 * Resend goes through the same native chat picker the invite screen uses
 * (#104) rather than mailing the link to the admin's own chat — one delivery
 * story, not two. Both actions exist only while the link is still claimable;
 * once it is spent or dead, the honest move is the reset below, not a resend.
 */
export function InviteSection({
  workspace,
  sharing,
  onResend,
  recovery,
}: {
  readonly workspace: WorkspaceDetail
  readonly sharing: boolean
  readonly onResend: () => void
  /**
   * Present only when the invite is already dead: reissuing then restores a way
   * forward rather than taking one away, so the action belongs beside the state
   * it repairs instead of under the danger heading.
   */
  readonly recovery?: {
    readonly label: string
    readonly pending: boolean
    readonly onStart: () => void
  }
}) {
  const invite = workspace.invite
  const headline = inviteHeadline(workspace)
  const copyController = useCopyLink(invite?.link)

  return (
    <Section className="mt-10" aria-labelledby="invite-heading">
      <SectionTitle id="invite-heading">Invite</SectionTitle>

      <Card size="sm" className="mt-4">
        <CardContent>
          <p
            className={cn(
              "flex items-center gap-2 text-base font-semibold",
              toneClass[headline.tone],
            )}
          >
            <span
              aria-hidden="true"
              className={cn("size-1.5 shrink-0 rounded-full", dotClass[headline.tone])}
            />
            {headline.title}
          </p>
          <p className="text-muted-foreground mt-2 text-sm leading-5">{headline.detail}</p>

          {invite?.link === undefined ? null : (
            <>
              <div className="mt-4">
                <InviteLinkPanel
                  link={invite.link}
                  ariaLabel="Coach onboarding link"
                  controller={copyController}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Button
                  size="lg"
                  disabled={sharing}
                  aria-busy={sharing || undefined}
                  className="h-11 font-semibold"
                  onClick={onResend}
                >
                  {sharing ? (
                    <>
                      <Spinner /> Sharing…
                    </>
                  ) : (
                    <>
                      <HugeiconsIcon icon={TelegramIcon} size={18} strokeWidth={1.8} />
                      Resend
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11 font-semibold"
                  onClick={() => void copyController.copy()}
                >
                  <HugeiconsIcon icon={Copy01Icon} size={18} strokeWidth={1.8} />
                  {copyController.copied ? "Copied" : "Copy link"}
                </Button>
              </div>
            </>
          )}

          {recovery === undefined ? null : (
            <Button
              size="lg"
              disabled={recovery.pending}
              aria-busy={recovery.pending || undefined}
              className="mt-4 h-11 w-full font-semibold"
              onClick={recovery.onStart}
            >
              {recovery.pending ? (
                <>
                  <Spinner /> Issuing…
                </>
              ) : (
                recovery.label
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {invite === undefined ? null : (
        <DetailCard>
          <DetailRow label="Sent via">{inviteChannel(invite)}</DetailRow>
          <DetailRow label="Issued">
            <TimestampValue value={invite.issuedAt} empty="Unknown" />
          </DetailRow>
          <DetailRow label="Expires">
            {invite.acceptedAt === undefined ? (
              <span className="flex flex-col items-end">
                <span>{formatExpiresIn(invite.expiresAt)}</span>
                <span className="text-muted-foreground text-xs font-normal">
                  {new Date(invite.expiresAt).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </span>
            ) : (
              // Acceptance retires the TTL (#112) — a countdown here would name
              // a deadline the coach does not actually have.
              <span className="text-muted-foreground font-normal">No longer applies</span>
            )}
          </DetailRow>
          <DetailRow label="Link opened">
            <TimestampValue value={invite.acceptedAt} empty="Not yet" />
          </DetailRow>
        </DetailCard>
      )}
    </Section>
  )
}
