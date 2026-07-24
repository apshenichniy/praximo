import { Copy01Icon, Mail01Icon, TelegramIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { WorkspaceNameMaxLength } from "@praximo/domain"
import { useState } from "react"
import type { ReactNode } from "react"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { Alert, AlertDescription } from "@/components/ui/alert.tsx"
import { Card } from "@/components/ui/card.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { setAdminNotice } from "@/features/admin/admin-notice.ts"
import { TextField } from "@/features/admin/components/form-fields.tsx"
import {
  InviteCopySheet,
  type InviteLanguage,
} from "@/features/admin/components/invite-copy-sheet.tsx"
import { notifyHaptic } from "@/features/admin/haptics.ts"
import { createCoachInviteMutation } from "@/features/admin/workspace-queries.ts"

export const Route = createFileRoute("/admin/workspaces/new")({
  component: InviteCoachPage,
})

const adminRoute = getRouteApi("/admin")

const errorMessages = {
  validation: "Something went wrong with this invite. Go back and try again.",
  conflict: "This invite draft was already used with different details. Go back and reopen it.",
  server: "The invite could not be created. Check your connection and try again.",
} as const

/**
 * Action-first "Invite a coach" screen (#103): one optional internal label and
 * three delivery actions. The workspace + invite are created lazily on the
 * first action under a stable requestId, so backing out creates nothing and
 * repeating an action never duplicates.
 */
function InviteCoachPage() {
  const { initData } = adminRoute.useLoaderData()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [requestId] = useState(() => crypto.randomUUID())
  const [name, setName] = useState("")
  const [actionError, setActionError] = useState<string>()
  const [emailNote, setEmailNote] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyError, setCopyError] = useState<string>()
  const [copyFallback, setCopyFallback] = useState<string>()

  const mutation = useMutation(createCoachInviteMutation(initData, queryClient))
  const pending = mutation.isPending

  const finish = (notice: string) => {
    setAdminNotice(notice)
    notifyHaptic("success")
    void navigate({ to: "/admin" })
  }

  const sendInTelegram = async () => {
    setActionError(undefined)
    setEmailNote(false)
    const response = await mutation
      .mutateAsync({
        input: { requestId, name },
        delivery: { channel: "telegram", language: "en" },
      })
      .catch(() => undefined)
    if (response === undefined) {
      setActionError(errorMessages.server)
      notifyHaptic("error")
      return
    }
    if (!response.ok) {
      setActionError(errorMessages[response.error])
      notifyHaptic("error")
      return
    }
    if (response.value.delivery === "failed") {
      setActionError(
        "The invite is ready, but Telegram delivery failed. Tap again — the same invite will be re-sent.",
      )
      notifyHaptic("error")
      return
    }
    finish("Invite sent to your Telegram chat — forward it to the coach")
  }

  const copyInvite = async (language: InviteLanguage) => {
    setCopyError(undefined)
    const response = await mutation
      .mutateAsync({ input: { requestId, name }, delivery: { channel: "copy", language } })
      .catch(() => undefined)
    if (response === undefined) {
      setCopyError(errorMessages.server)
      notifyHaptic("error")
      return
    }
    if (!response.ok) {
      setCopyError(errorMessages[response.error])
      notifyHaptic("error")
      return
    }
    try {
      await navigator.clipboard.writeText(response.value.message)
    } catch {
      // Clipboard denied after the async hop — hand the message over for a
      // direct-gesture copy instead.
      setCopyFallback(response.value.message)
      return
    }
    finish("Invite copied — paste it to the coach")
  }

  const copyFallbackDirect = (message: string) => {
    void navigator.clipboard.writeText(message).catch(() => undefined)
    finish("Invite copied — paste it to the coach")
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pt-6 pb-10">
      <TelegramBackButton onBack={() => void navigate({ to: "/admin" })} />

      <header className="mt-7">
        <h1 className="text-3xl font-semibold tracking-tight">Invite a coach</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-5">
          They&rsquo;ll set up their own profile during onboarding — you just get the invite to
          them.
        </p>
      </header>

      <div className="mt-8">
        <TextField
          label={
            <>
              Coach name <span className="text-muted-foreground font-normal">(optional)</span>
            </>
          }
          name="name"
          value={name}
          maxLength={WorkspaceNameMaxLength}
          placeholder="e.g. Ada Lovelace"
          error={undefined}
          onChange={setName}
          onBlur={() => undefined}
        />
        <p className="text-muted-foreground mt-2 text-xs">
          Only labels the invite in your list until they join.
        </p>
      </div>

      <h2 className="text-muted-foreground mt-8 text-xs font-semibold tracking-widest uppercase">
        Send the invite
      </h2>
      <Card className="divide-border mt-3 gap-0 divide-y overflow-hidden py-0">
        <InviteAction
          icon={<HugeiconsIcon icon={TelegramIcon} size={22} strokeWidth={1.8} />}
          title="Send in Telegram"
          subtitle="The bot sends it to your chat — forward it to the coach"
          disabled={pending}
          onClick={() => void sendInTelegram()}
        />
        <InviteAction
          icon={<HugeiconsIcon icon={Mail01Icon} size={22} strokeWidth={1.8} />}
          title="Send by email"
          subtitle="We'll email them a join link"
          disabled={pending}
          onClick={() => {
            setActionError(undefined)
            setEmailNote(true)
          }}
        />
        <InviteAction
          icon={<HugeiconsIcon icon={Copy01Icon} size={22} strokeWidth={1.8} />}
          title="Copy invite"
          subtitle="Paste anywhere — WhatsApp, Slack, SMS"
          disabled={pending}
          onClick={() => {
            setActionError(undefined)
            setEmailNote(false)
            setCopyError(undefined)
            setCopyFallback(undefined)
            setCopyOpen(true)
          }}
        />
      </Card>

      {emailNote ? (
        <Alert className="mt-4">
          <AlertDescription>Email delivery is coming soon.</AlertDescription>
        </Alert>
      ) : null}

      {actionError === undefined ? null : (
        <Alert variant="destructive" className="bg-destructive/10 mt-4 border-transparent">
          <AlertDescription className="text-destructive">{actionError}</AlertDescription>
        </Alert>
      )}

      {pending ? (
        <p className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
          <Spinner /> Preparing the invite…
        </p>
      ) : null}

      <p className="text-muted-foreground mt-auto border-t pt-4 text-xs leading-5">
        The link works once and expires in 7 days. You can resend it anytime.
      </p>

      <InviteCopySheet
        open={copyOpen}
        onOpenChange={setCopyOpen}
        pending={pending}
        error={copyError}
        fallbackMessage={copyFallback}
        onCopy={(language) => void copyInvite(language)}
        onCopyFallback={copyFallbackDirect}
      />
    </main>
  )
}

function InviteAction({
  icon,
  title,
  subtitle,
  disabled,
  onClick,
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly subtitle: string
  readonly disabled: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="hover:bg-muted active:bg-accent/70 flex min-h-[70px] w-full items-center gap-4 px-4 py-3 text-left transition-colors disabled:opacity-60"
    >
      <span className="border-primary/50 text-primary flex size-11 shrink-0 items-center justify-center rounded-full border">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="text-muted-foreground block text-xs leading-4">{subtitle}</span>
      </span>
    </button>
  )
}
