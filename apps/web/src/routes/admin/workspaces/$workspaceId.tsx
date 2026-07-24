import { revalidateLogic, useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router"
import {
  WorkspaceDescriptionMaxLength,
  WorkspaceNameMaxLength,
  WorkspaceShortDescriptionMaxLength,
} from "@praximo/domain"
import { useRef, useState } from "react"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { Alert, AlertDescription } from "@/components/ui/alert.tsx"
import { Button } from "@/components/ui/button.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { ActionBar } from "@/features/admin/components/action-bar.tsx"
import { AvatarEditor, AvatarEditorMessage } from "@/features/admin/components/avatar-editor.tsx"
import { ConfirmDialog } from "@/features/admin/components/confirm-dialog.tsx"
import { DangerZone } from "@/features/admin/components/danger-zone.tsx"
import { TextField, TextareaField } from "@/features/admin/components/form-fields.tsx"
import { OnboardingSection } from "@/features/admin/components/onboarding-section.tsx"
import { Section, SectionTitle } from "@/features/admin/components/section.tsx"
import { StatusSection } from "@/features/admin/components/status-section.tsx"
import { initials } from "@/features/admin/formatting.ts"
import { notifyHaptic } from "@/features/admin/haptics.ts"
import { useAvatarPicker } from "@/features/admin/hooks/use-avatar-picker.ts"
import { useUnsavedChanges } from "@/features/admin/hooks/use-unsaved-changes.ts"
import { useWorkspaceAvatar } from "@/features/admin/hooks/use-workspace-avatar.ts"
import {
  adminWorkspaceDetailQuery,
  deleteWorkspaceMutation,
  reissueWorkspaceInviteMutation,
  retryWorkspaceBrandingMutation,
  updateWorkspaceProfileMutation,
} from "@/features/admin/workspace-queries.ts"
import {
  fieldError,
  focusFirstInvalidField,
  optionalLimit,
  requiredName,
} from "@/features/admin/validation.ts"
import { resendAdminWorkspaceInvite } from "@/server/admin-workspaces.functions.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

export const Route = createFileRoute("/admin/workspaces/$workspaceId")({
  component: WorkspaceDetailsPage,
})

const adminRoute = getRouteApi("/admin")

function WorkspaceDetailsPage() {
  const { workspaceId } = Route.useParams()
  const { initData } = adminRoute.useLoaderData()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { data: workspace } = useSuspenseQuery(adminWorkspaceDetailQuery(initData, workspaceId))

  const [avatarRevision, setAvatarRevision] = useState(0)
  const [saveMessage, setSaveMessage] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  const [retryAvatar, setRetryAvatar] = useState(false)
  const [inviteResult, setInviteResult] = useState<AdminSurface.CreateResult>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmationName, setConfirmationName] = useState("")
  const [deleteError, setDeleteError] = useState<string>()
  const reissueRequestId = useRef<string | undefined>(undefined)
  const deleteRequestId = useRef<string | undefined>(undefined)

  const avatar = useAvatarPicker({ onChange: () => setSaveMessage(undefined) })
  const currentAvatar = useWorkspaceAvatar({
    initData,
    workspaceId,
    hasCustomAvatar: workspace.hasCustomAvatar,
    revision: avatarRevision,
  })

  const update = useMutation(updateWorkspaceProfileMutation(initData, queryClient))
  const retryBranding = useMutation(retryWorkspaceBrandingMutation(initData, queryClient))
  const reissue = useMutation(reissueWorkspaceInviteMutation(initData, queryClient))
  const remove = useMutation(deleteWorkspaceMutation(initData, queryClient))
  const resend = useMutation({
    mutationFn: (inviteId: string) => resendAdminWorkspaceInvite({ data: { initData, inviteId } }),
    onSuccess: (result) => {
      if (result.ok) setInviteResult(result.value)
    },
  })

  const form = useForm({
    defaultValues: {
      name: workspace.name,
      description: workspace.description ?? "",
      shortDescription: workspace.shortDescription ?? "",
    },
    validationLogic: revalidateLogic({ mode: "blur", modeAfterSubmission: "change" }),
    onSubmit: async ({ value }) => {
      setSaveMessage(undefined)
      setSaveError(undefined)
      const response = await update
        .mutateAsync({
          workspaceId,
          input: {
            requestId: crypto.randomUUID(),
            expectedUpdatedAt: workspace.updatedAt,
            name: value.name,
            description: value.description,
            shortDescription: value.shortDescription,
            avatarIntent: avatar.intent,
          },
          ...(avatar.file === undefined ? {} : { avatar: avatar.file }),
        })
        .catch(() => undefined)
      if (response === undefined) {
        setSaveError("Saving failed. Check your connection and try again.")
        notifyHaptic("error")
        return
      }
      if (!response.ok) {
        const messages = {
          validation: "Check the highlighted fields and try again.",
          conflict: "Workspace changed elsewhere. Reload and review before saving.",
          avatar: "The selected avatar is not a valid normalized JPEG.",
          upload: "Avatar upload failed. No profile changes were saved.",
          server: "Saving failed. Please try again.",
        } as const
        setSaveError(messages[response.error])
        notifyHaptic("error")
        return
      }

      const saved = response.value.workspace
      form.reset({
        name: saved.name,
        description: saved.description ?? "",
        shortDescription: saved.shortDescription ?? "",
      })
      avatar.undo()
      setRetryAvatar(response.value.retryAvatar)
      setAvatarRevision((revision) => revision + 1)
      if (response.value.status === "saved") {
        setSaveMessage("Changes saved")
        notifyHaptic("success")
      } else {
        setSaveMessage("Changes saved, but Telegram update failed")
        notifyHaptic("warning")
      }
    },
  })

  const guard = useUnsavedChanges(() => form.state.isDirty || avatar.intent !== "keep")

  const displayAvatarUrl =
    avatar.intent === "replace"
      ? avatar.previewUrl
      : avatar.intent === "reset"
        ? undefined
        : currentAvatar.url

  const reloadProfile = () => {
    setSaveError(undefined)
    void queryClient
      .fetchQuery(adminWorkspaceDetailQuery(initData, workspaceId))
      .then((current) => {
        form.reset({
          name: current.name,
          description: current.description ?? "",
          shortDescription: current.shortDescription ?? "",
        })
        avatar.undo()
      })
      .catch(() => setSaveError("The current profile could not be reloaded."))
  }

  const retryTelegram = () => {
    setSaveError(undefined)
    void retryBranding
      .mutateAsync({ workspaceId, retryAvatar })
      .then((result) => {
        if (result.ok && result.value.status === "saved") {
          setSaveMessage("Changes saved")
        } else {
          setSaveMessage("Changes saved, but Telegram update failed")
        }
      })
      .catch(() => setSaveMessage("Changes saved, but Telegram update failed"))
  }

  const currentInvite =
    inviteResult === undefined
      ? workspace.invite
      : {
          id: inviteResult.inviteId,
          status: "pending" as const,
          issuedAt: new Date().toISOString(),
          expiresAt: inviteResult.expiresAt,
          link: inviteResult.link,
        }

  const reissueInvite = () => {
    if (currentInvite === undefined) return
    reissueRequestId.current ??= crypto.randomUUID()
    void reissue
      .mutateAsync({
        workspaceId,
        expectedInviteId: currentInvite.id,
        requestId: reissueRequestId.current,
      })
      .then((result) => {
        if (!result.ok) return
        setInviteResult(result.value)
        reissueRequestId.current = undefined
      })
  }

  const resendInvite = () => {
    if (currentInvite === undefined) return
    resend.mutate(currentInvite.id)
  }

  const deleteWorkspace = async () => {
    deleteRequestId.current ??= crypto.randomUUID()
    setDeleteError(undefined)
    const result = await remove
      .mutateAsync({
        workspaceId,
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
      const messages = {
        validation: "The deletion request is invalid. Close this dialog and try again.",
        confirmation: `Enter “${workspace.name}” exactly as shown.`,
        conflict: "Another deletion request is already in progress. Retry from this dialog.",
        retryable: "A required cleanup step failed. The workspace was kept; retry deletion.",
        blocked:
          "The connected bot could not be released. The workspace was kept; contact support before retrying.",
        server: "Deletion failed. The workspace was kept; try again.",
      } as const
      setDeleteError(messages[result.error])
      notifyHaptic("error")
      return
    }

    notifyHaptic("success")
    sessionStorage.setItem(
      "praximo.workspaceDeleted",
      result.value.status === "deleted-farewell-undeliverable"
        ? "Workspace deleted. The coach farewell could not be delivered."
        : "Workspace deleted",
    )
    await router.navigate({ to: "/admin" })
  }

  const clearSaveMessage = () => setSaveMessage(undefined)

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-6 pb-32">
      <TelegramBackButton onBack={guard.requestBack} />
      <ConfirmDialog
        open={guard.confirmOpen}
        onOpenChange={guard.setConfirmOpen}
        title="Discard changes?"
        description="Unsaved profile changes will be lost."
        confirmLabel="Discard changes"
        confirmVariant="destructive"
        onConfirm={guard.confirmDiscard}
      />

      <header className="mt-7 text-center">
        <AvatarEditor
          imageUrl={displayAvatarUrl}
          fallback={initials(workspace.name)}
          loading={avatar.intent === "keep" && currentAvatar.loading}
          disabled={avatar.processing || update.isPending}
          srLabel={workspace.hasCustomAvatar ? "Replace avatar" : "Choose custom avatar"}
          onSelectFile={(file) => void avatar.choose(file)}
        />
        <div className="mt-1 flex justify-center">
          {avatar.intent !== "keep" ? (
            <Button
              variant="link"
              size="sm"
              className="text-muted-foreground"
              onClick={avatar.undo}
            >
              Undo avatar change
            </Button>
          ) : workspace.hasCustomAvatar ? (
            <Button
              variant="link"
              size="sm"
              className="text-muted-foreground"
              onClick={avatar.reset}
            >
              Reset to Praximo default
            </Button>
          ) : null}
        </div>
        {avatar.processing ? (
          <AvatarEditorMessage tone="muted">Processing…</AvatarEditorMessage>
        ) : null}
        {avatar.error === undefined ? null : (
          <AvatarEditorMessage tone="destructive">{avatar.error}</AvatarEditorMessage>
        )}
        {currentAvatar.failed ? (
          <AvatarEditorMessage tone="warning">
            The custom avatar could not be loaded. You can still edit this workspace.
          </AvatarEditorMessage>
        ) : null}
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{workspace.name}</h1>
        {workspace.botUsername === undefined ? null : (
          <a
            href={`https://t.me/${workspace.botUsername}`}
            className="text-muted-foreground mt-2 inline-block"
          >
            @{workspace.botUsername}
          </a>
        )}
      </header>

      <form
        className="mt-10"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit().then(() => {
            if (!form.state.isValid) focusFirstInvalidField()
          })
        }}
      >
        <Section className="mt-0 space-y-6" aria-labelledby="profile-heading">
          <SectionTitle id="profile-heading">Profile</SectionTitle>

          <form.Field name="name" validators={{ onDynamic: ({ value }) => requiredName(value) }}>
            {(field) => (
              <TextField
                label="Workspace name"
                name={field.name}
                value={field.state.value}
                maxLength={WorkspaceNameMaxLength + 1}
                error={fieldError(field.state.meta.errors)}
                onBlur={field.handleBlur}
                onChange={(value) => {
                  field.handleChange(value)
                  clearSaveMessage()
                }}
              />
            )}
          </form.Field>

          <form.Field
            name="description"
            validators={{
              onDynamic: ({ value }) => optionalLimit(WorkspaceDescriptionMaxLength)(value),
            }}
          >
            {(field) => (
              <TextareaField
                label="Description"
                name={field.name}
                value={field.state.value}
                maxLength={WorkspaceDescriptionMaxLength + 1}
                counter={WorkspaceDescriptionMaxLength}
                rows={4}
                error={fieldError(field.state.meta.errors)}
                onBlur={field.handleBlur}
                onChange={(value) => {
                  field.handleChange(value)
                  clearSaveMessage()
                }}
              />
            )}
          </form.Field>

          <form.Field
            name="shortDescription"
            validators={{
              onDynamic: ({ value }) => optionalLimit(WorkspaceShortDescriptionMaxLength)(value),
            }}
          >
            {(field) => (
              <TextareaField
                label="Short description"
                name={field.name}
                value={field.state.value}
                maxLength={WorkspaceShortDescriptionMaxLength + 1}
                counter={WorkspaceShortDescriptionMaxLength}
                rows={2}
                error={fieldError(field.state.meta.errors)}
                onBlur={field.handleBlur}
                onChange={(value) => {
                  field.handleChange(value)
                  clearSaveMessage()
                }}
              />
            )}
          </form.Field>
        </Section>

        <StatusSection workspace={workspace} />
        <OnboardingSection
          workspace={workspace}
          invite={currentInvite}
          delivery={inviteResult?.delivery}
          resendPending={resend.isPending}
          reissuePending={reissue.isPending}
          onResend={resendInvite}
          onReissue={reissueInvite}
        />
        <form.Subscribe selector={(state) => state.isDirty}>
          {(formDirty) => (
            <DangerZone
              workspaceName={workspace.name}
              open={deleteOpen}
              confirmationName={confirmationName}
              error={deleteError}
              disabled={
                formDirty ||
                avatar.intent !== "keep" ||
                update.isPending ||
                avatar.processing ||
                remove.isPending
              }
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
          )}
        </form.Subscribe>

        {saveError === undefined ? null : (
          <Alert variant="destructive" className="bg-destructive/10 mt-8 border-transparent">
            <AlertDescription className="text-destructive">
              <p>{saveError}</p>
              {saveError.startsWith("Workspace changed") ? (
                <button
                  type="button"
                  onClick={reloadProfile}
                  className="mt-2 font-semibold underline"
                >
                  Reload current profile
                </button>
              ) : null}
            </AlertDescription>
          </Alert>
        )}

        <ActionBar>
          {saveMessage === undefined ? (
            <form.Subscribe selector={(state) => state.isDirty}>
              {(formDirty) =>
                formDirty || avatar.intent !== "keep" ? (
                  <p className="text-muted-foreground mb-3 text-sm">Unsaved changes</p>
                ) : null
              }
            </form.Subscribe>
          ) : (
            <div className="mb-3 flex items-center justify-between gap-3 text-sm">
              <span
                className={saveMessage.includes("failed") ? "text-amber-200" : "text-emerald-300"}
              >
                {saveMessage}
              </span>
              {saveMessage.includes("failed") ? (
                <button
                  type="button"
                  disabled={retryBranding.isPending}
                  onClick={retryTelegram}
                  className="font-semibold underline disabled:opacity-50"
                >
                  {retryBranding.isPending ? "Retrying…" : "Retry Telegram update"}
                </button>
              ) : null}
            </div>
          )}
          <form.Subscribe selector={(state) => state.isDirty}>
            {(formDirty) => (
              <Button
                type="submit"
                size="lg"
                disabled={
                  (!formDirty && avatar.intent === "keep") ||
                  update.isPending ||
                  avatar.processing ||
                  avatar.error !== undefined
                }
                aria-busy={update.isPending || undefined}
                className="h-13 w-full font-semibold"
              >
                {update.isPending ? (
                  <>
                    <Spinner /> Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            )}
          </form.Subscribe>
        </ActionBar>
      </form>
    </main>
  )
}
