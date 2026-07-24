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
  const expired = invite.status === "expired"

  return (
    <>
      <p className="text-base font-semibold">
        {expired ? "Invite expired" : "Current onboarding invite"}
      </p>
      <p className="text-muted-foreground mt-2 text-sm">
        {expired
          ? `Expired ${formatTimestamp(invite.expiresAt, "date unavailable")}`
          : `Expires ${formatTimestamp(invite.expiresAt, "date unavailable")}`}
      </p>

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
          ) : expired ? (
            "Issue new link"
          ) : (
            "Re-issue link"
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
        title={expired ? "Issue a new onboarding link?" : "Re-issue the onboarding link?"}
        description={expired ? undefined : "The current link will stop working immediately."}
        confirmLabel={expired ? "Issue new link" : "Re-issue link"}
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
