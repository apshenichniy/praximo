import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { useRef, useState } from "react"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { ConfirmDialog } from "@/features/admin/components/confirm-dialog.tsx"
import { Alert, AlertDescription } from "@/components/ui/alert.tsx"
import {
  AboutSection,
  CoachStatusSection,
  PracticeSection,
} from "@/features/admin/components/active-sections.tsx"
import {
  DangerZone,
  DeleteWorkspaceCard,
  ResetInviteCard,
} from "@/features/admin/components/danger-zone.tsx"
import { InviteSection } from "@/features/admin/components/invite-section.tsx"
import { LabelSettingsSection } from "@/features/admin/components/label-settings-section.tsx"
import { OnboardingStepsSection } from "@/features/admin/components/onboarding-steps.tsx"
import { WorkspaceDetailHeader } from "@/features/admin/components/workspace-detail-header.tsx"
import { setAdminNotice } from "@/features/admin/admin-notice.ts"
import { notifyHaptic } from "@/features/admin/haptics.ts"
import { useInviteShare } from "@/features/admin/hooks/use-invite-share.ts"
import {
  detailSubtitle,
  detailVariant,
  reissueCopy,
  type WorkspaceDetail,
} from "@/features/admin/workspace-detail.ts"
import {
  adminWorkspaceDetailQuery,
  deleteWorkspaceMutation,
  reissueWorkspaceInviteMutation,
} from "@/features/admin/workspace-queries.ts"
import { openTelegramLink } from "@/lib/telegram.ts"

export const Route = createFileRoute("/admin/workspaces/$workspaceId")({
  component: WorkspaceDetailsPage,
})

const adminRoute = getRouteApi("/admin")

const deleteMessages = {
  validation: "The deletion request is invalid. Close this dialog and try again.",
  conflict: "Another deletion request is already in progress. Retry from this dialog.",
  retryable: "A required cleanup step failed. The workspace was kept; retry deletion.",
  blocked:
    "The connected bot could not be released. The workspace was kept; contact support before retrying.",
  server: "Deletion failed. The workspace was kept; try again.",
} as const

/**
 * Two screens behind one route (#108). Which one a coach gets is not a local
 * guess: the server hands back the same onboarding stage the list rows carry,
 * and its absence *is* the completion signal. A coach mid-onboarding sees the
 * invite, its progression, and the ways to push it along; an active coach sees
 * status first, then the little that is actually theirs to configure.
 *
 * Neither variant edits bot branding — that belongs to the coach.
 */
function WorkspaceDetailsPage() {
  const { workspaceId } = Route.useParams()
  const { initData } = adminRoute.useLoaderData()
  const { data: workspace } = useSuspenseQuery(adminWorkspaceDetailQuery(initData, workspaceId))

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-6 pb-16">
      <TelegramBackButton />
      {detailVariant(workspace) === "active" ? (
        <ActiveWorkspace workspace={workspace} initData={initData} />
      ) : (
        <OnboardingWorkspace workspace={workspace} initData={initData} />
      )}
    </main>
  )
}

function ActiveWorkspace({
  workspace,
  initData,
}: {
  readonly workspace: WorkspaceDetail
  readonly initData: string
}) {
  return (
    <>
      <WorkspaceDetailHeader
        name={workspace.name}
        botUsername={workspace.botUsername}
        subtitle={detailSubtitle(workspace)}
        onOpenBot={(link) => void openTelegramLink(link)}
      />
      <CoachStatusSection workspace={workspace} />
      <AboutSection workspace={workspace} />
      <PracticeSection />
      <LabelSettingsSection workspace={workspace} initData={initData} />
      <WorkspaceDangerZone workspace={workspace} initData={initData} />
    </>
  )
}

function OnboardingWorkspace({
  workspace,
  initData,
}: {
  readonly workspace: WorkspaceDetail
  readonly initData: string
}) {
  const queryClient = useQueryClient()
  const [shareError, setShareError] = useState<string>()
  const [shareNotice, setShareNotice] = useState<string>()
  const [resetOpen, setResetOpen] = useState(false)
  const inviteShare = useInviteShare(initData)
  const reissue = useMutation(reissueWorkspaceInviteMutation(initData, queryClient))
  // Minted once per attempt and reused across retries, so a network failure
  // that actually landed replays the same reissue instead of minting a second.
  const reissueRequestId = useRef<string | undefined>(undefined)

  const invite = workspace.invite
  const reset = reissueCopy(workspace)
  const canReset = workspace.canReissue && invite !== undefined

  const resetInvite = () => {
    if (invite === undefined) return
    reissueRequestId.current ??= crypto.randomUUID()
    void reissue
      .mutateAsync({
        workspaceId: workspace.id,
        expectedInviteId: invite.id,
        requestId: reissueRequestId.current,
      })
      .then((result) => {
        if (!result.ok) return
        reissueRequestId.current = undefined
        notifyHaptic("success")
      })
  }

  const resend = async () => {
    if (invite?.link === undefined || invite.message === undefined) return
    setShareError(undefined)
    setShareNotice(undefined)
    switch (
      await inviteShare.share({
        inviteId: invite.id,
        link: invite.link,
        // The server built this in the language the invite last left in, so a
        // resend never switches languages on the coach mid-onboarding.
        message: invite.message,
        language: invite.language ?? "en",
      })
    ) {
      // A dismissed picker is not a failure: the invite is untouched and tapping
      // again is safe, so the screen simply stays as it was.
      case "dismissed":
        return
      case "no-telegram":
        setShareError("Open this from Telegram to share the invite.")
        notifyHaptic("error")
        return
      case "failed":
        setShareError("Telegram couldn't prepare the invite. Tap Resend to retry.")
        notifyHaptic("error")
        return
      case "fallback":
      case "shared":
        setShareNotice("Invite sent again — the same link still works.")
        notifyHaptic("success")
    }
  }

  return (
    <>
      <WorkspaceDetailHeader
        name={workspace.name}
        botUsername={workspace.botUsername}
        subtitle={detailSubtitle(workspace)}
        onOpenBot={(link) => void openTelegramLink(link)}
      />
      <InviteSection
        workspace={workspace}
        sharing={inviteShare.sharingInviteId !== undefined}
        onResend={() => void resend()}
        {...(canReset && !reset.destructive
          ? {
              recovery: {
                label: reset.label,
                pending: reissue.isPending,
                onStart: () => setResetOpen(true),
              },
            }
          : {})}
      />
      {shareError === undefined ? null : (
        <Alert variant="destructive" className="bg-destructive/10 mt-4 border-transparent">
          <AlertDescription className="text-destructive">{shareError}</AlertDescription>
        </Alert>
      )}
      {shareNotice === undefined ? null : (
        <Alert className="mt-4">
          <AlertDescription>{shareNotice}</AlertDescription>
        </Alert>
      )}
      <OnboardingStepsSection workspace={workspace} />
      <WorkspaceDangerZone workspace={workspace} initData={initData}>
        {canReset && reset.destructive ? (
          <ResetInviteCard
            copy={reset}
            pending={reissue.isPending}
            onOpen={() => setResetOpen(true)}
          />
        ) : null}
      </WorkspaceDangerZone>
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={reset.title}
        description={reset.description}
        confirmLabel={reset.label}
        confirmVariant={reset.destructive ? "destructive" : "default"}
        onConfirm={() => {
          setResetOpen(false)
          resetInvite()
        }}
      />
    </>
  )
}

function WorkspaceDangerZone({
  workspace,
  initData,
  children,
}: {
  readonly workspace: WorkspaceDetail
  readonly initData: string
  readonly children?: ReactNode
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmationName, setConfirmationName] = useState("")
  const [deleteError, setDeleteError] = useState<string>()
  // Minted once per attempt and reused across retries, so an interrupted
  // deletion resumes the same operation instead of starting a second one.
  const deleteRequestId = useRef<string | undefined>(undefined)

  const remove = useMutation(deleteWorkspaceMutation(initData, queryClient))

  const deleteWorkspace = async () => {
    deleteRequestId.current ??= crypto.randomUUID()
    setDeleteError(undefined)
    const result = await remove
      .mutateAsync({
        workspaceId: workspace.id,
        requestId: deleteRequestId.current,
        confirmationName,
      })
      .catch(() => undefined)
    if (result === undefined) {
      setDeleteError("Deletion failed. Check your connection and try again.")
      notifyHaptic("error")
      return
    }
    if (!result.ok) {
      setDeleteError(
        result.error === "confirmation"
          ? `Enter “${workspace.name}” exactly as shown.`
          : deleteMessages[result.error],
      )
      notifyHaptic("error")
      return
    }

    notifyHaptic("success")
    setAdminNotice(
      result.value.status === "deleted-farewell-undeliverable"
        ? "Workspace deleted. The coach farewell could not be delivered."
        : "Workspace deleted",
    )
    await router.navigate({ to: "/admin" })
  }

  return (
    <DangerZone>
      {children}
      <DeleteWorkspaceCard
        workspaceName={workspace.name}
        open={deleteOpen}
        confirmationName={confirmationName}
        error={deleteError}
        pending={remove.isPending}
        onOpenChange={(open) => {
          setDeleteOpen(open)
          if (!open) {
            setConfirmationName("")
            setDeleteError(undefined)
          }
        }}
        onConfirmationNameChange={(value) => {
          setConfirmationName(value)
          setDeleteError(undefined)
        }}
        onDelete={() => void deleteWorkspace()}
      />
    </DangerZone>
  )
}
