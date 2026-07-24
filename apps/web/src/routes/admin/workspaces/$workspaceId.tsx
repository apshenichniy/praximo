import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
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
import { DeleteWorkspaceSheet } from "@/features/admin/components/delete-workspace-sheet.tsx"
import { WorkspaceDeletionPanel } from "@/features/admin/components/deletion-panel.tsx"
import { InviteSection } from "@/features/admin/components/invite-section.tsx"
import { LabelSettingsSection } from "@/features/admin/components/label-settings-section.tsx"
import { OnboardingStepsSection } from "@/features/admin/components/onboarding-steps.tsx"
import { WorkspaceDetailHeader } from "@/features/admin/components/workspace-detail-header.tsx"
import { WorkspaceDetailSkeleton } from "@/features/admin/components/workspace-detail-skeleton.tsx"
import { notifyHaptic } from "@/features/admin/haptics.ts"
import { useInviteShare } from "@/features/admin/hooks/use-invite-share.ts"
import { useWorkspaceDeletion } from "@/features/admin/hooks/use-workspace-deletion.ts"
import {
  detailVariant,
  reissueCopy,
  type WorkspaceDetail,
} from "@/features/admin/workspace-detail.ts"
import { deletionCardCopy } from "@/features/admin/workspace-deletion.ts"
import {
  adminWorkspaceDeletionQuery,
  adminWorkspaceDetailQuery,
  reissueWorkspaceInviteMutation,
} from "@/features/admin/workspace-queries.ts"
import { openTelegramLink } from "@/lib/telegram.ts"

export const Route = createFileRoute("/admin/workspaces/$workspaceId")({
  // Loaded here rather than only by the component's suspense query, so the
  // router has the coach in hand before it swaps screens. Combined with the
  // app-wide `defaultPreload: "intent"`, a tap that follows a touch-down has
  // usually already fetched, and nothing pending is shown at all.
  //
  // The deletion receipt is loaded beside it — almost always empty, and the one
  // fact that decides whether this screen shows a workspace or its purge.
  loader: async ({ context, params }) => {
    const [workspace] = await Promise.all([
      context.queryClient.ensureQueryData(
        adminWorkspaceDetailQuery(context.initData, params.workspaceId),
      ),
      context.queryClient.ensureQueryData(
        adminWorkspaceDeletionQuery(context.initData, params.workspaceId),
      ),
    ])
    return workspace
  },
  // Only worth a skeleton once the wait is perceptible; below that the flash
  // costs more than it explains.
  pendingMs: 150,
  pendingMinMs: 300,
  pendingComponent: WorkspaceDetailSkeleton,
  component: WorkspaceDetailsPage,
})

const adminRoute = getRouteApi("/admin")

/**
 * Two screens behind one route (#108). Which one a coach gets is not a local
 * guess: the server hands back the same onboarding stage the list rows carry,
 * and its absence *is* the completion signal. A coach mid-onboarding sees the
 * invite, its progression, and the ways to push it along; an active coach sees
 * status first, then the little that is actually theirs to configure.
 *
 * A third state outranks both: a workspace being deleted shows its pipeline and
 * nothing else (#110).
 *
 * Neither variant edits bot branding — that belongs to the coach.
 */
function WorkspaceDetailsPage() {
  const { workspaceId } = Route.useParams()
  const { initData } = adminRoute.useLoaderData()
  const { data: workspace } = useSuspenseQuery(adminWorkspaceDetailQuery(initData, workspaceId))
  const deletion = useWorkspaceDeletion(initData, workspaceId)
  const progress = deletion.progress
  // Owned by the page rather than the danger zone: the moment a deletion is
  // prepared the sections below give way to the pipeline panel, and a sheet
  // living inside them would be unmounted mid-run by its own success.
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-6 pb-16">
      <TelegramBackButton />
      <WorkspaceDetailHeader
        workspace={workspace}
        onOpenBot={(link) => void openTelegramLink(link)}
      />
      {progress === undefined ? null : (
        <WorkspaceDeletionPanel
          progress={progress}
          advancing={deletion.advancing}
          error={deletion.error}
          onResume={deletion.start}
        />
      )}
      {progress !== undefined ? null : detailVariant(workspace) === "active" ? (
        <ActiveWorkspace
          workspace={workspace}
          initData={initData}
          onDelete={() => setDeleteOpen(true)}
        />
      ) : (
        <OnboardingWorkspace
          workspace={workspace}
          initData={initData}
          onDelete={() => setDeleteOpen(true)}
        />
      )}
      <DeleteWorkspaceSheet
        workspace={workspace}
        open={deleteOpen}
        progress={progress}
        advancing={deletion.advancing}
        error={deletion.error}
        onOpenChange={setDeleteOpen}
        onConfirm={deletion.start}
      />
    </main>
  )
}

function ActiveWorkspace({
  workspace,
  initData,
  onDelete,
}: {
  readonly workspace: WorkspaceDetail
  readonly initData: string
  readonly onDelete: () => void
}) {
  return (
    <>
      <CoachStatusSection workspace={workspace} />
      <AboutSection workspace={workspace} />
      <PracticeSection />
      <LabelSettingsSection workspace={workspace} initData={initData} />
      <WorkspaceDangerZone workspace={workspace} onDelete={onDelete} />
    </>
  )
}

function OnboardingWorkspace({
  workspace,
  initData,
  onDelete,
}: {
  readonly workspace: WorkspaceDetail
  readonly initData: string
  readonly onDelete: () => void
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
      <WorkspaceDangerZone workspace={workspace} onDelete={onDelete}>
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
  onDelete,
  children,
}: {
  readonly workspace: WorkspaceDetail
  readonly onDelete: () => void
  readonly children?: ReactNode
}) {
  return (
    <DangerZone>
      {children}
      <DeleteWorkspaceCard copy={deletionCardCopy(workspace)} onOpen={onDelete} />
    </DangerZone>
  )
}
