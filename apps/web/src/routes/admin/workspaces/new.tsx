import { CameraAdd01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { revalidateLogic, useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate, useRouter } from "@tanstack/react-router"
import {
  WorkspaceDescriptionMaxLength,
  WorkspaceNameMaxLength,
  WorkspaceShortDescriptionMaxLength,
} from "@praximo/domain"
import { useCallback, useEffect, useRef, useState } from "react"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { AvatarProcessingError, normalizeAvatarFile } from "@/features/admin/avatar-normalizer.ts"
import { createWorkspaceMutation, workspaceKeys } from "@/features/admin/workspace-queries.ts"
import { loadTelegramWebApp } from "@/lib/telegram.ts"
import { resendAdminWorkspaceInvite } from "@/server/admin-workspaces.functions.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

export const Route = createFileRoute("/admin/workspaces/new")({
  component: CreateWorkspacePage,
})

const adminRoute = getRouteApi("/admin")

const inputClassName =
  "bg-card ring-border focus:ring-primary/60 w-full rounded-2xl px-4 py-3.5 text-base ring-1 outline-none transition-shadow focus:ring-2"

const fieldError = (errors: ReadonlyArray<unknown>): string | undefined => {
  const first = errors[0]
  return typeof first === "string" ? first : undefined
}

const requiredName = (value: string): string | undefined => {
  const normalized = value.trim()
  if (normalized.length === 0) return "Workspace name is required"
  if (normalized.length > WorkspaceNameMaxLength) {
    return `Use ${WorkspaceNameMaxLength} characters or fewer`
  }
  return undefined
}

const requiredLanguage = (value: string): string | undefined =>
  value === "en" || value === "uk" || value === "ru" ? undefined : "Choose the coach language"

const optionalLimit =
  (limit: number) =>
  (value: string): string | undefined =>
    value.trim().length > limit ? `Use ${limit} characters or fewer` : undefined

const coachLanguages = [
  { value: "en", label: "English" },
  { value: "uk", label: "Українська" },
  { value: "ru", label: "Русский" },
] as const

function CreateWorkspacePage() {
  const { initData } = adminRoute.useLoaderData()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const [avatar, setAvatar] = useState<File>()
  const [avatarPreview, setAvatarPreview] = useState<string>()
  const [avatarTouched, setAvatarTouched] = useState(false)
  const [avatarError, setAvatarError] = useState<string>()
  const [processingAvatar, setProcessingAvatar] = useState(false)
  const [submitError, setSubmitError] = useState<string>()
  const [result, setResult] = useState<AdminSurface.CreateResult>()

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
          ...(avatar === undefined ? {} : { avatar }),
        })
        .catch(() => undefined)
      if (response === undefined) {
        setSubmitError("Workspace creation failed. Check your connection and try again.")
        return
      }
      if (response.ok) {
        setResult(response.value)
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
    },
  })

  const isDirty = () => form.state.isDirty || avatarTouched
  const goBack = useCallback(() => {
    if (isDirty() && result === undefined && !window.confirm("Discard workspace draft?")) return
    router.history.back()
  }, [form, avatarTouched, result, router])

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty() || result !== undefined) return
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [form, avatarTouched, result])

  useEffect(
    () => () => {
      if (avatarPreview !== undefined) URL.revokeObjectURL(avatarPreview)
    },
    [avatarPreview],
  )

  const chooseAvatar = async (file: File | undefined) => {
    if (file === undefined) return
    setAvatarTouched(true)
    setAvatarError(undefined)
    setProcessingAvatar(true)
    try {
      const normalized = await normalizeAvatarFile(file)
      if (avatarPreview !== undefined) URL.revokeObjectURL(avatarPreview)
      setAvatar(normalized.file)
      setAvatarPreview(URL.createObjectURL(normalized.file))
    } catch (error) {
      setAvatar(undefined)
      setAvatarPreview(undefined)
      setAvatarError(
        error instanceof AvatarProcessingError && error.reason === "size"
          ? "Choose an image up to 10 MB."
          : error instanceof AvatarProcessingError && error.reason === "type"
            ? "Choose a JPEG, PNG, or WebP image."
            : "This image could not be processed.",
      )
    } finally {
      setProcessingAvatar(false)
    }
  }

  const removeAvatar = () => {
    if (avatarPreview !== undefined) URL.revokeObjectURL(avatarPreview)
    setAvatar(undefined)
    setAvatarPreview(undefined)
    setAvatarTouched(true)
    setAvatarError(undefined)
  }

  if (result !== undefined) {
    return (
      <WorkspaceCreated
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
      <TelegramBackButton onBack={goBack} />

      <header className="mt-7 text-center">
        <label className="group relative mx-auto block size-24 cursor-pointer">
          <span className="admin-avatar ring-border flex size-24 items-center justify-center overflow-hidden rounded-full text-3xl font-bold ring-1">
            {avatarPreview === undefined ? (
              "P"
            ) : (
              <img
                src={avatarPreview}
                alt="Workspace avatar preview"
                className="size-full object-cover"
              />
            )}
          </span>
          <span className="bg-primary text-primary-foreground absolute right-0 bottom-0 flex size-9 items-center justify-center rounded-full ring-4 ring-background">
            <HugeiconsIcon icon={CameraAdd01Icon} size={19} strokeWidth={2} />
          </span>
          <span className="sr-only">
            {avatar === undefined ? "Choose avatar" : "Replace avatar"}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={processingAvatar || mutation.isPending}
            onChange={(event) => {
              void chooseAvatar(event.target.files?.[0])
              event.target.value = ""
            }}
          />
        </label>
        {avatar !== undefined ? (
          <button
            type="button"
            onClick={removeAvatar}
            className="text-muted-foreground mt-3 text-sm"
          >
            Remove custom avatar
          </button>
        ) : null}
        {processingAvatar ? (
          <p className="text-muted-foreground mt-3 text-sm">Processing…</p>
        ) : null}
        {avatarError ? <p className="text-destructive mt-3 text-sm">{avatarError}</p> : null}

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
            if (!form.state.isValid) {
              document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus()
            }
          })
        }}
      >
        <form.Field name="name" validators={{ onDynamic: ({ value }) => requiredName(value) }}>
          {(field) => {
            const error = fieldError(field.state.meta.errors)
            return (
              <label className="block">
                <span className="mb-2 block text-sm font-medium">Workspace name</span>
                <input
                  name={field.name}
                  value={field.state.value}
                  maxLength={65}
                  aria-invalid={error === undefined ? undefined : true}
                  aria-describedby={error === undefined ? undefined : `${field.name}-error`}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className={inputClassName}
                  placeholder="Ada Coaching"
                />
                {error ? (
                  <span id={`${field.name}-error`} className="text-destructive mt-2 block text-sm">
                    {error}
                  </span>
                ) : null}
              </label>
            )
          }}
        </form.Field>

        <form.Field
          name="coachLanguage"
          validators={{ onDynamic: ({ value }) => requiredLanguage(value) }}
        >
          {(field) => {
            const error = fieldError(field.state.meta.errors)
            return (
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Coach language</legend>
                <div className="bg-card ring-border grid grid-cols-3 gap-1 rounded-2xl p-1 ring-1">
                  {coachLanguages.map(({ value, label }) => (
                    <label
                      key={value}
                      className={`cursor-pointer rounded-xl px-2 py-3 text-center text-sm transition-colors ${
                        field.state.value === value
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-muted-foreground"
                      }`}
                    >
                      <input
                        type="radio"
                        name={field.name}
                        value={value}
                        checked={field.state.value === value}
                        aria-invalid={error === undefined ? undefined : true}
                        onBlur={field.handleBlur}
                        onChange={() => field.handleChange(value)}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {error ? (
                  <span className="text-destructive mt-2 block text-sm">{error}</span>
                ) : null}
              </fieldset>
            )
          }}
        </form.Field>

        <form.Field
          name="description"
          validators={{
            onDynamic: ({ value }) => optionalLimit(WorkspaceDescriptionMaxLength)(value),
          }}
        >
          {(field) => {
            const error = fieldError(field.state.meta.errors)
            return (
              <label className="block">
                <span className="mb-2 flex items-center justify-between text-sm font-medium">
                  <span>
                    Description <span className="text-muted-foreground">(optional)</span>
                  </span>
                  <span className="text-muted-foreground font-normal">
                    {field.state.value.length}/512
                  </span>
                </span>
                <textarea
                  name={field.name}
                  value={field.state.value}
                  maxLength={513}
                  rows={4}
                  aria-invalid={error === undefined ? undefined : true}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className={`${inputClassName} resize-none`}
                  placeholder="What this coach helps with"
                />
                {error ? (
                  <span className="text-destructive mt-2 block text-sm">{error}</span>
                ) : null}
              </label>
            )
          }}
        </form.Field>

        <form.Field
          name="shortDescription"
          validators={{
            onDynamic: ({ value }) => optionalLimit(WorkspaceShortDescriptionMaxLength)(value),
          }}
        >
          {(field) => {
            const error = fieldError(field.state.meta.errors)
            return (
              <label className="block">
                <span className="mb-2 flex items-center justify-between text-sm font-medium">
                  <span>
                    Short description <span className="text-muted-foreground">(optional)</span>
                  </span>
                  <span className="text-muted-foreground font-normal">
                    {field.state.value.length}/120
                  </span>
                </span>
                <textarea
                  name={field.name}
                  value={field.state.value}
                  maxLength={121}
                  rows={2}
                  aria-invalid={error === undefined ? undefined : true}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className={`${inputClassName} resize-none`}
                  placeholder="A short Telegram profile line"
                />
                {error ? (
                  <span className="text-destructive mt-2 block text-sm">{error}</span>
                ) : null}
              </label>
            )
          }}
        </form.Field>

        {submitError ? (
          <p
            role="alert"
            className="bg-destructive/10 text-destructive rounded-2xl px-4 py-3 text-sm"
          >
            {submitError}
          </p>
        ) : null}

        <div className="border-border bg-background/95 fixed inset-x-0 bottom-0 z-10 border-t px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto max-w-2xl">
            <button
              type="submit"
              disabled={mutation.isPending || processingAvatar || avatarError !== undefined}
              className="bg-primary text-primary-foreground h-13 w-full rounded-2xl font-semibold transition-opacity disabled:opacity-50"
            >
              {mutation.isPending ? "Creating…" : "Create workspace"}
            </button>
          </div>
        </div>
      </form>
    </main>
  )
}

function WorkspaceCreated({
  result,
  initData,
  onResultChange,
  onDone,
}: {
  readonly result: AdminSurface.CreateResult
  readonly initData: string
  readonly onResultChange: (result: AdminSurface.CreateResult) => void
  readonly onDone: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [resendWarning, setResendWarning] = useState(false)
  const fallbackRef = useRef<HTMLTextAreaElement>(null)
  const resend = useMutation({
    mutationFn: () => resendAdminWorkspaceInvite({ data: { initData, inviteId: result.inviteId } }),
    onSuccess: (response) => {
      if (response.ok) onResultChange(response.value)
    },
  })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.link)
      setCopied(true)
      const webApp = await loadTelegramWebApp()
      webApp?.HapticFeedback?.notificationOccurred("success")
    } catch {
      fallbackRef.current?.focus()
      fallbackRef.current?.select()
    }
  }

  const deliveryCopy =
    result.delivery === "sent"
      ? "The onboarding message was sent to the manager chat."
      : result.delivery === "failed"
        ? "Workspace created, but Telegram delivery failed."
        : "Workspace already existed. Check delivery before sending again."

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pt-16 pb-10">
      <div className="admin-avatar mx-auto flex size-20 items-center justify-center rounded-full text-3xl font-bold">
        ✓
      </div>
      <h1 className="mt-7 text-center text-3xl font-semibold tracking-tight">Workspace created</h1>
      <p className="text-muted-foreground mt-3 text-center text-sm">{deliveryCopy}</p>

      <section className="bg-card ring-border mt-9 rounded-2xl p-4 ring-1">
        <p className="text-sm font-medium">One-time coach link</p>
        <textarea
          ref={fallbackRef}
          readOnly
          value={result.link}
          rows={3}
          className="bg-background ring-border mt-3 w-full resize-none rounded-xl p-3 text-sm ring-1 outline-none"
          aria-label="One-time coach link"
        />
        <p className="text-muted-foreground mt-2 text-xs">
          Expires {new Date(result.expiresAt).toLocaleString()}. Opening it does not consume it;
          successful bot provisioning does.
        </p>
        <button
          type="button"
          onClick={() => void copy()}
          className="bg-primary text-primary-foreground mt-4 h-12 w-full rounded-xl font-semibold"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </section>

      {result.delivery !== "sent" ? (
        <section className="mt-5">
          {resendWarning ? (
            <p className="bg-amber-400/10 text-amber-200 rounded-xl px-4 py-3 text-sm">
              The previous message may already have arrived. Sending again can create a duplicate
              message, never a duplicate workspace or link.
            </p>
          ) : null}
          {resend.isSuccess && !resend.data.ok ? (
            <p className="bg-destructive/10 text-destructive mt-3 rounded-xl px-4 py-3 text-sm">
              The onboarding message could not be sent. Copy the link above or try again.
            </p>
          ) : null}
          {resend.isError ? (
            <p className="bg-destructive/10 text-destructive mt-3 rounded-xl px-4 py-3 text-sm">
              Resending failed unexpectedly. Copy the link above or try again.
            </p>
          ) : null}
          <button
            type="button"
            disabled={resend.isPending}
            onClick={() => {
              if (!resendWarning) {
                setResendWarning(true)
                return
              }
              resend.mutate()
            }}
            className="ring-border mt-3 h-12 w-full rounded-xl font-semibold ring-1 disabled:opacity-50"
          >
            {resend.isPending
              ? "Sending…"
              : resendWarning
                ? "Send again anyway"
                : "Try sending again"}
          </button>
        </section>
      ) : null}

      <button
        type="button"
        onClick={onDone}
        className="bg-primary text-primary-foreground mt-auto h-13 w-full rounded-2xl font-semibold"
      >
        Done
      </button>
    </main>
  )
}
