import { useState } from "react"

import { Button } from "@/components/ui/button.tsx"
import { Card, CardContent } from "@/components/ui/card.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { ConfirmDialog } from "@/features/admin/components/confirm-dialog.tsx"
import { InviteLinkPanel } from "@/features/admin/components/invite-link-panel.tsx"
import { Section, SectionTitle } from "@/features/admin/components/section.tsx"
import { formatTimestamp } from "@/features/admin/formatting.ts"
import { useCopyLink } from "@/features/admin/hooks/use-copy-link.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

type Invite = AdminSurface.WorkspaceDetail["invite"]

function OnboardingCompleted({ workspace }: { readonly workspace: AdminSurface.WorkspaceDetail }) {
  return (
    <>
      <p className="text-base font-semibold">Onboarding completed</p>
      <p className="text-muted-foreground mt-2 text-sm">
        Invited {formatTimestamp(workspace.invite?.issuedAt, "date unavailable")}. Re-linking is
        managed separately from coach onboarding.
      </p>
    </>
  )
}

function OnboardingNotInvited() {
  return (
    <>
      <p className="text-base font-semibold">Not invited</p>
      <p className="text-muted-foreground mt-2 text-sm">This workspace has no onboarding invite.</p>
    </>
  )
}

/**
 * The invite card's headline, one line per lifecycle state. An accepted claim
 * deliberately reports when it was claimed rather than when the original link
 * would have expired — acceptance retires that deadline (#112).
 */
const inviteHeading = (
  invite: NonNullable<Invite>,
): { readonly title: string; readonly detail: string } => {
  switch (invite.status) {
    case "accepted":
      return {
        title: "Accepted · setup in progress",
        detail: `Accepted ${formatTimestamp(invite.acceptedAt, "recently")}. The link no longer expires.`,
      }
    case "cancelled":
      return {
        title:
          invite.cancellationReason === "declined_by_coach"
            ? "Invitation declined"
            : "Invitation reset",
        detail: `Cancelled ${formatTimestamp(invite.cancelledAt, "date unavailable")}. The old link no longer works.`,
      }
    case "expired":
      return {
        title: "Invite expired",
        detail: `Expired ${formatTimestamp(invite.expiresAt, "date unavailable")}`,
      }
    default:
      return {
        title: "Current onboarding invite",
        detail: `Expires ${formatTimestamp(invite.expiresAt, "date unavailable")}`,
      }
  }
}

/**
 * Reset/reissue is always explicit and always confirmed (#107). Resetting an
 * *accepted* claim is the one case that takes something away from a coach who
 * already started, so it says so rather than hiding behind "re-issue".
 */
const reissueConfirmation = (
  invite: NonNullable<Invite>,
): { readonly label: string; readonly title: string; readonly description?: string } => {
  switch (invite.status) {
    case "accepted":
      return {
        label: "Reset invite",
        title: "Reset this coach's setup?",
        description:
          "Their claim is released and the link they already opened stops working. They will need the new link to start over.",
      }
    case "expired":
    case "cancelled":
      return { label: "Issue new link", title: "Issue a new onboarding link?" }
    default:
      return {
        label: "Re-issue link",
        title: "Re-issue the onboarding link?",
        description: "The current link will stop working immediately.",
      }
  }
}

function OnboardingActiveInvite({
  invite,
  delivery,
  canReissue,
  resendPending,
  reissuePending,
  onResend,
  onReissue,
}: {
  readonly invite: NonNullable<Invite>
  readonly delivery: AdminSurface.DeliveryStatus | undefined
  readonly canReissue: boolean
  readonly resendPending: boolean
  readonly reissuePending: boolean
  readonly onResend: () => void
  readonly onReissue: () => void
}) {
  const [resendConfirmOpen, setResendConfirmOpen] = useState(false)
  const [reissueConfirmOpen, setReissueConfirmOpen] = useState(false)
  const copyController = useCopyLink(invite.link)
  const heading = inviteHeading(invite)
  const reissueCopy = reissueConfirmation(invite)

  return (
    <>
      <p className="text-base font-semibold">{heading.title}</p>
      <p className="text-muted-foreground mt-2 text-sm">{heading.detail}</p>

      {invite.link === undefined ? null : (
        <>
          <div className="mt-4">
            <InviteLinkPanel
              link={invite.link}
              ariaLabel="Current coach onboarding link"
              controller={copyController}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Button
              size="lg"
              className="h-11 font-semibold"
              onClick={() => void copyController.copy()}
            >
              {copyController.copied ? "Copied" : "Copy link"}
            </Button>
            <Button
              variant="outline"
              size="lg"
              disabled={resendPending}
              aria-busy={resendPending || undefined}
              className="h-11 font-semibold"
              onClick={() => setResendConfirmOpen(true)}
            >
              {resendPending ? (
                <>
                  <Spinner /> Sending…
                </>
              ) : (
                "Send again"
              )}
            </Button>
          </div>
        </>
      )}

      {delivery === "failed" ? (
        <p className="text-amber-200 mt-3 text-sm">
          The invite was issued, but Telegram delivery failed. The link remains valid.
        </p>
      ) : delivery === "sent" ? (
        <p className="text-emerald-300 mt-3 text-sm">
          The onboarding message was sent to the manager chat.
        </p>
      ) : null}

      {canReissue ? (
        <Button
          variant="destructive"
          size="lg"
          disabled={reissuePending}
          aria-busy={reissuePending || undefined}
          className="mt-5 h-11 w-full font-semibold"
          onClick={() => setReissueConfirmOpen(true)}
        >
          {reissuePending ? (
            <>
              <Spinner /> Issuing…
            </>
          ) : (
            reissueCopy.label
          )}
        </Button>
      ) : null}

      <ConfirmDialog
        open={resendConfirmOpen}
        onOpenChange={setResendConfirmOpen}
        title="Send the link again?"
        description="The previous message may already have arrived. Send the same link again?"
        confirmLabel="Send again"
        onConfirm={() => {
          setResendConfirmOpen(false)
          onResend()
        }}
      />
      <ConfirmDialog
        open={reissueConfirmOpen}
        onOpenChange={setReissueConfirmOpen}
        title={reissueCopy.title}
        description={reissueCopy.description}
        confirmLabel={reissueCopy.label}
        confirmVariant="destructive"
        onConfirm={() => {
          setReissueConfirmOpen(false)
          onReissue()
        }}
      />
    </>
  )
}

export function OnboardingSection({
  workspace,
  invite,
  delivery,
  resendPending,
  reissuePending,
  onResend,
  onReissue,
}: {
  readonly workspace: AdminSurface.WorkspaceDetail
  readonly invite: Invite
  readonly delivery: AdminSurface.DeliveryStatus | undefined
  readonly resendPending: boolean
  readonly reissuePending: boolean
  readonly onResend: () => void
  readonly onReissue: () => void
}) {
  const completed = workspace.botStatus !== "awaiting-setup" || workspace.invite?.status === "used"

  return (
    <Section aria-labelledby="onboarding-heading">
      <SectionTitle id="onboarding-heading">Onboarding</SectionTitle>
      <Card size="sm" className="mt-4">
        <CardContent>
          {completed ? (
            <OnboardingCompleted workspace={workspace} />
          ) : invite === undefined ? (
            <OnboardingNotInvited />
          ) : (
            <OnboardingActiveInvite
              invite={invite}
              delivery={delivery}
              canReissue={workspace.canReissue}
              resendPending={resendPending}
              reissuePending={reissuePending}
              onResend={onResend}
              onReissue={onReissue}
            />
          )}
        </CardContent>
      </Card>
    </Section>
  )
}
