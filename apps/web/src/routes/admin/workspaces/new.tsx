import { revalidateLogic, useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import {
  WorkspaceDescriptionMaxLength,
  WorkspaceNameMaxLength,
  WorkspaceShortDescriptionMaxLength,
} from "@praximo/domain"
import { useState } from "react"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { Alert, AlertDescription } from "@/components/ui/alert.tsx"
import { Button } from "@/components/ui/button.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { ActionBar } from "@/features/admin/components/action-bar.tsx"
import { AvatarEditor, AvatarEditorMessage } from "@/features/admin/components/avatar-editor.tsx"
import { ConfirmDialog } from "@/features/admin/components/confirm-dialog.tsx"
import { OptionalHint, TextField, TextareaField } from "@/features/admin/components/form-fields.tsx"
import { LanguagePicker } from "@/features/admin/components/language-picker.tsx"
import { WorkspaceCreatedScreen } from "@/features/admin/components/workspace-created.tsx"
import { notifyHaptic } from "@/features/admin/haptics.ts"
import { useAvatarPicker } from "@/features/admin/hooks/use-avatar-picker.ts"
import { useUnsavedChanges } from "@/features/admin/hooks/use-unsaved-changes.ts"
import { createWorkspaceMutation, workspaceKeys } from "@/features/admin/workspace-queries.ts"
import {
  fieldError,
  focusFirstInvalidField,
  optionalLimit,
  requiredLanguage,
  requiredName,
} from "@/features/admin/validation.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

export const Route = createFileRoute("/admin/workspaces/new")({
  component: CreateWorkspacePage,
})

const adminRoute = getRouteApi("/admin")

function CreateWorkspacePage() {
  const { initData } = adminRoute.useLoaderData()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string>()
  const [result, setResult] = useState<AdminSurface.CreateResult>()
  const avatar = useAvatarPicker()

  const mutation = useMutation(createWorkspaceMutation(initData, queryClient))

  const form = useForm({
    defaultValues: {
      requestId: crypto.randomUUID(),
      name: "",
      coachLanguage: "",
      description: "",
      shortDescription: "",
    },
    validationLogic: revalidateLogic({ mode: "blur", modeAfterSubmission: "change" }),
    onSubmit: async ({ value }) => {
      setSubmitError(undefined)
      const response = await mutation
        .mutateAsync({
          input: value,
          ...(avatar.file === undefined ? {} : { avatar: avatar.file }),
        })
        .catch(() => undefined)
      if (response === undefined) {
        setSubmitError("Workspace creation failed. Check your connection and try again.")
        notifyHaptic("error")
        return
      }
      if (response.ok) {
        setResult(response.value)
        notifyHaptic("success")
        return
      }
      const messages = {
        validation: "Check the highlighted fields and try again.",
        conflict: "This request was already used with different workspace details.",
        avatar: "The selected avatar is not a valid normalized JPEG.",
        upload: "Avatar upload failed. The workspace was not created.",
        server: "Workspace creation failed. Please try again.",
      } as const
      setSubmitError(messages[response.error])
      notifyHaptic("error")
    },
  })

  const guard = useUnsavedChanges(
    () => (form.state.isDirty || avatar.touched) && result === undefined,
  )

  if (result !== undefined) {
    return (
      <WorkspaceCreatedScreen
        result={result}
        initData={initData}
        onResultChange={setResult}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: workspaceKeys.list() })
          void navigate({ to: "/admin" })
        }}
      />
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pt-6 pb-32">
      <TelegramBackButton onBack={guard.requestBack} />
      <ConfirmDialog
        open={guard.confirmOpen}
        onOpenChange={guard.setConfirmOpen}
        title="Discard workspace draft?"
        description="The details you entered will be lost."
        confirmLabel="Discard draft"
        confirmVariant="destructive"
        onConfirm={guard.confirmDiscard}
      />

      <header className="mt-7 text-center">
        <AvatarEditor
          imageUrl={avatar.previewUrl}
          fallback="P"
          disabled={avatar.processing || mutation.isPending}
          srLabel={avatar.file === undefined ? "Choose avatar" : "Replace avatar"}
          onSelectFile={(file) => void avatar.choose(file)}
        />
        {avatar.file === undefined ? null : (
          <Button
            variant="link"
            size="sm"
            className="text-muted-foreground mt-3"
            onClick={avatar.undo}
          >
            Remove custom avatar
          </Button>
        )}
        {avatar.processing ? (
          <AvatarEditorMessage tone="muted">Processing…</AvatarEditorMessage>
        ) : null}
        {avatar.error === undefined ? null : (
          <AvatarEditorMessage tone="destructive">{avatar.error}</AvatarEditorMessage>
        )}

        <h1 className="mt-7 text-3xl font-semibold tracking-tight">New workspace</h1>
        <p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm leading-5">
          Create the coach profile and a one-time onboarding link.
        </p>
      </header>

      <form
        className="mt-9 space-y-6"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit().then(() => {
            if (!form.state.isValid) focusFirstInvalidField()
          })
        }}
      >
        <form.Field name="name" validators={{ onDynamic: ({ value }) => requiredName(value) }}>
          {(field) => (
            <TextField
              label="Workspace name"
              name={field.name}
              value={field.state.value}
              maxLength={WorkspaceNameMaxLength + 1}
              placeholder="Ada Coaching"
              error={fieldError(field.state.meta.errors)}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
            />
          )}
        </form.Field>

        <form.Field
          name="coachLanguage"
          validators={{ onDynamic: ({ value }) => requiredLanguage(value) }}
        >
          {(field) => (
            <LanguagePicker
              name={field.name}
              value={field.state.value}
              error={fieldError(field.state.meta.errors)}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
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
              label={
                <>
                  Description <OptionalHint />
                </>
              }
              name={field.name}
              value={field.state.value}
              maxLength={WorkspaceDescriptionMaxLength + 1}
              counter={WorkspaceDescriptionMaxLength}
              rows={4}
              placeholder="What this coach helps with"
              error={fieldError(field.state.meta.errors)}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
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
              label={
                <>
                  Short description <OptionalHint />
                </>
              }
              name={field.name}
              value={field.state.value}
              maxLength={WorkspaceShortDescriptionMaxLength + 1}
              counter={WorkspaceShortDescriptionMaxLength}
              rows={2}
              placeholder="A short Telegram profile line"
              error={fieldError(field.state.meta.errors)}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
            />
          )}
        </form.Field>

        {submitError === undefined ? null : (
          <Alert variant="destructive" className="bg-destructive/10 border-transparent">
            <AlertDescription className="text-destructive">{submitError}</AlertDescription>
          </Alert>
        )}

        <ActionBar>
          <Button
            type="submit"
            size="lg"
            disabled={mutation.isPending || avatar.processing || avatar.error !== undefined}
            aria-busy={mutation.isPending || undefined}
            className="h-13 w-full font-semibold"
          >
            {mutation.isPending ? (
              <>
                <Spinner /> Creating…
              </>
            ) : (
              "Create workspace"
            )}
          </Button>
        </ActionBar>
      </form>
    </main>
  )
}
