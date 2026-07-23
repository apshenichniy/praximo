import { CameraAdd01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { revalidateLogic, useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router"
import {
  WorkspaceDescriptionMaxLength,
  WorkspaceNameMaxLength,
  WorkspaceShortDescriptionMaxLength,
} from "@praximo/domain"
import { useCallback, useEffect, useRef, useState } from "react"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { AvatarProcessingError, normalizeAvatarFile } from "@/features/admin/avatar-normalizer.ts"
import {
  adminWorkspaceDetailQuery,
  reissueWorkspaceInviteMutation,
  retryWorkspaceBrandingMutation,
  updateWorkspaceProfileMutation,
} from "@/features/admin/workspace-queries.ts"
import { loadTelegramWebApp } from "@/lib/telegram.ts"
import {
  loadAdminWorkspaceAvatar,
  resendAdminWorkspaceInvite,
} from "@/server/admin-workspaces.functions.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

export const Route = createFileRoute("/admin/workspaces/$workspaceId")({
  component: WorkspaceDetailsPage,
})

const adminRoute = getRouteApi("/admin")
const inputClassName =
  "bg-card ring-border focus:ring-primary/60 w-full rounded-2xl px-4 py-3.5 text-base ring-1 outline-none transition-shadow focus:ring-2"

const requiredName = (value: string): string | undefined => {
  const normalized = value.trim()
  if (normalized.length === 0) return "Workspace name is required"
  if (normalized.length > WorkspaceNameMaxLength) {
    return `Use ${WorkspaceNameMaxLength} characters or fewer`
  }
  return undefined
}

const optionalLimit =
  (limit: number) =>
  (value: string): string | undefined =>
    value.trim().length > limit ? `Use ${limit} characters or fewer` : undefined

const fieldError = (errors: ReadonlyArray<unknown>): string | undefined => {
  const first = errors[0]
  return typeof first === "string" ? first : undefined
}

const formatTimestamp = (value: string | undefined, empty: string): string =>
  value === undefined
    ? empty
    : new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))

const statusLabel = {
  "awaiting-setup": "Awaiting setup",
  connected: "Connected",
  "needs-relink": "Needs re-link",
} as const

const languageLabel = {
  en: "English",
  uk: "Українська",
  ru: "Русский",
} as const

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")

function WorkspaceDetailsPage() {
  const { workspaceId } = Route.useParams()
  const { initData } = adminRoute.useLoaderData()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { data: workspace } = useSuspenseQuery(adminWorkspaceDetailQuery(initData, workspaceId))
  const [avatarFile, setAvatarFile] = useState<File>()
  const [avatarIntent, setAvatarIntent] = useState<"keep" | "replace" | "reset">("keep")
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string>()
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string>()
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false)
  const [avatarError, setAvatarError] = useState<string>()
  const [processingAvatar, setProcessingAvatar] = useState(false)
  const [avatarRevision, setAvatarRevision] = useState(0)
  const [saveMessage, setSaveMessage] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  const [retryAvatar, setRetryAvatar] = useState(false)
  const [inviteResult, setInviteResult] = useState<AdminSurface.CreateResult>()
  const reissueRequestId = useRef<string | undefined>(undefined)

  const update = useMutation(updateWorkspaceProfileMutation(initData, queryClient))
  const retryBranding = useMutation(retryWorkspaceBrandingMutation(initData, queryClient))
  const reissue = useMutation(reissueWorkspaceInviteMutation(initData, queryClient))
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
            avatarIntent,
          },
          ...(avatarFile === undefined ? {} : { avatar: avatarFile }),
        })
        .catch(() => undefined)
      if (response === undefined) {
        setSaveError("Saving failed. Check your connection and try again.")
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
        return
      }

      const saved = response.value.workspace
      form.reset({
        name: saved.name,
        description: saved.description ?? "",
        shortDescription: saved.shortDescription ?? "",
      })
      if (avatarPreviewUrl !== undefined) URL.revokeObjectURL(avatarPreviewUrl)
      setAvatarFile(undefined)
      setAvatarPreviewUrl(undefined)
      setAvatarIntent("keep")
      setRetryAvatar(response.value.retryAvatar)
      setAvatarRevision((revision) => revision + 1)
      setSaveMessage(
        response.value.status === "saved"
          ? "Changes saved"
          : "Changes saved, but Telegram update failed",
      )
    },
  })

  const isDirty = () => form.state.isDirty || avatarIntent !== "keep"
  const goBack = useCallback(() => {
    if (isDirty() && !window.confirm("Discard changes?")) return
    router.history.back()
  }, [avatarIntent, form, router])

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [avatarIntent, form])

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined
    setAvatarLoadFailed(false)
    setCurrentAvatarUrl(undefined)
    if (!workspace.hasCustomAvatar) return

    void loadAdminWorkspaceAvatar({ data: { initData, workspaceId } }).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setAvatarLoadFailed(true)
        return
      }
      const binary = atob(result.base64)
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.contentType }))
      setCurrentAvatarUrl(objectUrl)
    })

    return () => {
      cancelled = true
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [avatarRevision, initData, workspace.hasCustomAvatar, workspaceId])

  useEffect(
    () => () => {
      if (avatarPreviewUrl !== undefined) URL.revokeObjectURL(avatarPreviewUrl)
    },
    [avatarPreviewUrl],
  )

  const chooseAvatar = async (file: File | undefined) => {
    if (file === undefined) return
    setAvatarError(undefined)
    setProcessingAvatar(true)
    setSaveMessage(undefined)
    try {
      const normalized = await normalizeAvatarFile(file)
      if (avatarPreviewUrl !== undefined) URL.revokeObjectURL(avatarPreviewUrl)
      setAvatarFile(normalized.file)
      setAvatarPreviewUrl(URL.createObjectURL(normalized.file))
      setAvatarIntent("replace")
    } catch (error) {
      setAvatarFile(undefined)
      setAvatarPreviewUrl(undefined)
      setAvatarIntent("keep")
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

  const resetAvatar = () => {
    if (avatarPreviewUrl !== undefined) URL.revokeObjectURL(avatarPreviewUrl)
    setAvatarFile(undefined)
    setAvatarPreviewUrl(undefined)
    setAvatarIntent("reset")
    setAvatarError(undefined)
    setSaveMessage(undefined)
  }

  const undoAvatar = () => {
    if (avatarPreviewUrl !== undefined) URL.revokeObjectURL(avatarPreviewUrl)
    setAvatarFile(undefined)
    setAvatarPreviewUrl(undefined)
    setAvatarIntent("keep")
    setAvatarError(undefined)
  }

  const displayAvatarUrl =
    avatarIntent === "replace"
      ? avatarPreviewUrl
      : avatarIntent === "reset"
        ? undefined
        : currentAvatarUrl

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
        if (avatarPreviewUrl !== undefined) URL.revokeObjectURL(avatarPreviewUrl)
        setAvatarIntent("keep")
        setAvatarFile(undefined)
        setAvatarPreviewUrl(undefined)
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

  const rotateInvite = () => {
    if (currentInvite === undefined) return
    if (
      !window.confirm(
        currentInvite.status === "expired"
          ? "Issue a new onboarding link?"
          : "Re-issue the onboarding link? The current link will stop working immediately.",
      )
    ) {
      return
    }
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

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-6 pb-32">
      <TelegramBackButton onBack={goBack} />

      <header className="mt-7 text-center">
        <label className="group relative mx-auto block size-24 cursor-pointer">
          <span className="admin-avatar ring-border flex size-24 items-center justify-center overflow-hidden rounded-full text-2xl font-bold ring-1">
            {displayAvatarUrl === undefined ? (
              initials(workspace.name)
            ) : (
              <img
                src={displayAvatarUrl}
                alt="Workspace avatar"
                className="size-full object-cover"
              />
            )}
          </span>
          <span className="bg-primary text-primary-foreground absolute right-0 bottom-0 flex size-9 items-center justify-center rounded-full ring-4 ring-background">
            <HugeiconsIcon icon={CameraAdd01Icon} size={19} strokeWidth={2} />
          </span>
          <span className="sr-only">
            {workspace.hasCustomAvatar ? "Replace avatar" : "Choose custom avatar"}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={processingAvatar || update.isPending}
            onChange={(event) => {
              void chooseAvatar(event.target.files?.[0])
              event.target.value = ""
            }}
          />
        </label>
        <div className="mt-3 flex justify-center gap-4 text-sm">
          {avatarIntent !== "keep" ? (
            <button type="button" onClick={undoAvatar} className="text-muted-foreground">
              Undo avatar change
            </button>
          ) : workspace.hasCustomAvatar ? (
            <button type="button" onClick={resetAvatar} className="text-muted-foreground">
              Reset to Praximo default
            </button>
          ) : null}
        </div>
        {processingAvatar ? (
          <p className="text-muted-foreground mt-3 text-sm">Processing…</p>
        ) : null}
        {avatarError ? <p className="text-destructive mt-3 text-sm">{avatarError}</p> : null}
        {avatarLoadFailed ? (
          <p className="text-amber-200 mt-3 text-sm">
            The custom avatar could not be loaded. You can still edit this workspace.
          </p>
        ) : null}
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{workspace.name}</h1>
        {workspace.botUsername ? (
          <a
            href={`https://t.me/${workspace.botUsername}`}
            className="text-muted-foreground mt-2 inline-block"
          >
            @{workspace.botUsername}
          </a>
        ) : null}
      </header>

      <form
        className="mt-10"
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
        <section className="space-y-6" aria-labelledby="profile-heading">
          <h2 id="profile-heading" className="px-1 text-2xl font-semibold tracking-tight">
            Profile
          </h2>

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
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.target.value)
                      setSaveMessage(undefined)
                    }}
                    className={inputClassName}
                  />
                  {error ? (
                    <span className="text-destructive mt-2 block text-sm">{error}</span>
                  ) : null}
                </label>
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
                  <span className="mb-2 flex justify-between text-sm font-medium">
                    <span>Description</span>
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
                    onChange={(event) => {
                      field.handleChange(event.target.value)
                      setSaveMessage(undefined)
                    }}
                    className={`${inputClassName} resize-none`}
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
                  <span className="mb-2 flex justify-between text-sm font-medium">
                    <span>Short description</span>
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
                    onChange={(event) => {
                      field.handleChange(event.target.value)
                      setSaveMessage(undefined)
                    }}
                    className={`${inputClassName} resize-none`}
                  />
                  {error ? (
                    <span className="text-destructive mt-2 block text-sm">{error}</span>
                  ) : null}
                </label>
              )
            }}
          </form.Field>
        </section>

        <StatusCard workspace={workspace} />
        <OnboardingCard
          workspace={workspace}
          invite={currentInvite}
          delivery={inviteResult?.delivery}
          resendPending={resend.isPending}
          reissuePending={reissue.isPending}
          onResend={() => {
            if (
              currentInvite !== undefined &&
              window.confirm(
                "The previous message may already have arrived. Send the same link again?",
              )
            ) {
              resend.mutate(currentInvite.id)
            }
          }}
          onReissue={rotateInvite}
        />

        {saveError ? (
          <div className="bg-destructive/10 text-destructive mt-8 rounded-2xl px-4 py-3 text-sm">
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
          </div>
        ) : null}

        <div className="border-border bg-background/95 fixed inset-x-0 bottom-0 z-10 border-t px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto max-w-2xl">
            {saveMessage ? (
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
            ) : null}
            <form.Subscribe selector={(state) => state.isDirty}>
              {(formDirty) => (
                <button
                  type="submit"
                  disabled={
                    (!formDirty && avatarIntent === "keep") ||
                    update.isPending ||
                    processingAvatar ||
                    avatarError !== undefined
                  }
                  className="bg-primary text-primary-foreground h-13 w-full rounded-2xl font-semibold transition-opacity disabled:opacity-50"
                >
                  {update.isPending ? "Saving…" : "Save changes"}
                </button>
              )}
            </form.Subscribe>
          </div>
        </div>
      </form>
    </main>
  )
}

function StatusCard({ workspace }: { readonly workspace: AdminSurface.WorkspaceDetail }) {
  return (
    <section className="mt-12" aria-labelledby="status-heading">
      <h2 id="status-heading" className="px-1 text-2xl font-semibold tracking-tight">
        Status
      </h2>
      <dl className="bg-card ring-border mt-4 overflow-hidden rounded-2xl ring-1">
        <StatusRow label="Bot connection" value={statusLabel[workspace.botStatus]} />
        <StatusRow
          label="Coach language"
          value={
            workspace.coachLanguage === undefined
              ? "Unknown"
              : languageLabel[workspace.coachLanguage]
          }
        />
        <StatusRow
          label="Bot username"
          value={
            workspace.botUsername === undefined ? "Not connected" : `@${workspace.botUsername}`
          }
        />
        <StatusRow
          label="Terms"
          value={workspace.termsAcceptedAt === undefined ? "Not accepted" : "Accepted"}
        />
        <StatusRow
          label="Invited"
          value={formatTimestamp(workspace.invite?.issuedAt, "Not invited")}
        />
        <StatusRow label="Created" value={formatTimestamp(workspace.createdAt, "Unknown")} />
        <StatusRow label="Last login" value={formatTimestamp(workspace.lastLoginAt, "Never")} />
        <StatusRow
          label="Last activity"
          value={formatTimestamp(workspace.lastActivityAt, "Never")}
        />
      </dl>
    </section>
  )
}

function StatusRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="border-border flex min-h-14 items-center justify-between gap-5 border-b px-4 py-3 last:border-b-0">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  )
}

function OnboardingCard({
  workspace,
  invite,
  delivery,
  resendPending,
  reissuePending,
  onResend,
  onReissue,
}: {
  readonly workspace: AdminSurface.WorkspaceDetail
  readonly invite: AdminSurface.WorkspaceDetail["invite"]
  readonly delivery: AdminSurface.DeliveryStatus | undefined
  readonly resendPending: boolean
  readonly reissuePending: boolean
  readonly onResend: () => void
  readonly onReissue: () => void
}) {
  const [copied, setCopied] = useState(false)
  const fallbackRef = useRef<HTMLTextAreaElement>(null)
  const completed = workspace.botStatus !== "awaiting-setup" || workspace.invite?.status === "used"

  const copy = async () => {
    if (invite?.link === undefined) return
    try {
      await navigator.clipboard.writeText(invite.link)
      setCopied(true)
      const webApp = await loadTelegramWebApp()
      webApp?.HapticFeedback?.notificationOccurred("success")
    } catch {
      fallbackRef.current?.focus()
      fallbackRef.current?.select()
    }
  }

  return (
    <section className="mt-12" aria-labelledby="onboarding-heading">
      <h2 id="onboarding-heading" className="px-1 text-2xl font-semibold tracking-tight">
        Onboarding
      </h2>
      <div className="bg-card ring-border mt-4 rounded-2xl p-5 ring-1">
        {completed ? (
          <>
            <p className="font-semibold">Onboarding completed</p>
            <p className="text-muted-foreground mt-2 text-sm">
              Invited {formatTimestamp(workspace.invite?.issuedAt, "date unavailable")}. Re-linking
              is managed separately from coach onboarding.
            </p>
          </>
        ) : invite === undefined ? (
          <>
            <p className="font-semibold">Not invited</p>
            <p className="text-muted-foreground mt-2 text-sm">
              This workspace has no onboarding invite.
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold">
              {invite.status === "expired" ? "Invite expired" : "Current onboarding invite"}
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              {invite.status === "expired"
                ? `Expired ${formatTimestamp(invite.expiresAt, "date unavailable")}`
                : `Expires ${formatTimestamp(invite.expiresAt, "date unavailable")}`}
            </p>
            {invite.link !== undefined ? (
              <>
                <textarea
                  ref={fallbackRef}
                  readOnly
                  value={invite.link}
                  rows={3}
                  aria-label="Current coach onboarding link"
                  className="bg-background ring-border mt-4 w-full resize-none rounded-xl p-3 text-sm ring-1 outline-none"
                />
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => void copy()}
                    className="bg-primary text-primary-foreground h-11 rounded-xl font-semibold"
                  >
                    {copied ? "Copied" : "Copy link"}
                  </button>
                  <button
                    type="button"
                    disabled={resendPending}
                    onClick={onResend}
                    className="ring-border h-11 rounded-xl font-semibold ring-1 disabled:opacity-50"
                  >
                    {resendPending ? "Sending…" : "Send again"}
                  </button>
                </div>
              </>
            ) : null}
            {delivery === "failed" ? (
              <p className="text-amber-200 mt-3 text-sm">
                The invite was issued, but Telegram delivery failed. The link remains valid.
              </p>
            ) : delivery === "sent" ? (
              <p className="text-emerald-300 mt-3 text-sm">
                The onboarding message was sent to the manager chat.
              </p>
            ) : null}
            {workspace.canReissue ? (
              <button
                type="button"
                disabled={reissuePending}
                onClick={onReissue}
                className="text-destructive ring-destructive/30 mt-5 h-11 w-full rounded-xl font-semibold ring-1 disabled:opacity-50"
              >
                {reissuePending
                  ? "Issuing…"
                  : invite.status === "expired"
                    ? "Issue new link"
                    : "Re-issue link"}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
