import { Copy01Icon, Mail01Icon, TelegramIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { type CoachLanguage, WorkspaceNameMaxLength } from "@praximo/domain"
import { useState } from "react"
import type { ReactNode } from "react"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { Alert, AlertDescription } from "@/components/ui/alert.tsx"
import { Card } from "@/components/ui/card.tsx"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { toast } from "@/components/ui/toast.tsx"
import { setAdminNotice } from "@/features/admin/admin-notice.ts"
import { TextField } from "@/features/admin/components/form-fields.tsx"
import { InviteCopySheet } from "@/features/mini-app/components/invite-copy-sheet.tsx"
import { InviteEmailSheet } from "@/features/admin/components/invite-email-sheet.tsx"
import { InviteLanguageChips } from "@/features/admin/components/invite-language-chips.tsx"
import { notifyHaptic } from "@/features/mini-app/haptics.ts"
import { useInviteShare } from "@/features/admin/hooks/use-invite-share.ts"
import { sendCoachInviteEmail } from "@/features/admin/invite-email.ts"
import { createCoachInviteMutation } from "@/features/admin/workspace-queries.ts"

export const Route = createFileRoute("/admin/workspaces/new")({
  component: InviteCoachPage,
})

const errorMessages = {
  validation: "Something went wrong with this invite. Go back and try again.",
  conflict: "This invite draft was already used with different details. Go back and reopen it.",
  server: "The invite could not be created. Check your connection and try again.",
} as const

/**
 * What the language starts at before the manager touches the chips. English is
 * the language every string in the product is authored in, so it is the honest
 * default rather than a guess about the coach — and the chips sit above the
 * actions precisely so the guess gets corrected before anything is sent.
 */
const DefaultInviteLanguage: CoachLanguage = "en"

/**
 * Action-first "Invite a coach" screen (#103): one optional internal label and
 * three delivery actions. The workspace + invite are created lazily on the
 * first action under a stable requestId, so backing out creates nothing and
 * repeating an action never duplicates.
 */
function InviteCoachPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [requestId] = useState(() => crypto.randomUUID())
  const [name, setName] = useState("")
  // One choice for every channel (#164). It is no longer only the language of
  // the message: the invite carries it to the claim, and it is what the coach's
  // whole bot setup speaks until they change it themselves.
  const [language, setLanguage] = useState<CoachLanguage>(DefaultInviteLanguage)
  // Once an invite exists, the label is committed — editing it would only
  // produce an idempotency conflict on the next tap.
  const [created, setCreated] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [emailOpen, setEmailOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyError, setCopyError] = useState<string>()
  const [copyFallback, setCopyFallback] = useState<string>()

  const mutation = useMutation(createCoachInviteMutation(queryClient))
  const inviteShare = useInviteShare()
  const pending = mutation.isPending || inviteShare.sharingInviteId !== undefined

  const finish = (notice: string) => {
    setAdminNotice(notice)
    notifyHaptic("success")
    void navigate({ to: "/admin" })
  }

  /**
   * Create the invite (lazy, idempotent under `requestId`), then hand it to
   * Telegram's native chat picker. The prepared inline message is minted *on
   * tap* — prepared messages are short-lived — and the fallback covers hosts
   * below Bot API 8.0. A cancelled picker leaves the invite pending: nothing is
   * duplicated on a retry, and nothing is stranded on a back-out.
   */
  const sendInTelegram = async () => {
    setActionError(undefined)
    const response = await mutation
      .mutateAsync({
        input: { requestId, name },
        delivery: { channel: "telegram", language },
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
    setCreated(true)

    const { inviteId, link, message } = response.value
    switch (await inviteShare.share({ inviteId, link, message, language })) {
      // A dismissed picker is not a failure: the invite stays pending, nothing
      // is recorded, and the manager can tap Share again. Leave the screen as is.
      case "dismissed":
        return
      case "no-telegram":
        setActionError("Open this from Telegram to share the invite.")
        notifyHaptic("error")
        return
      case "failed":
        setActionError("Telegram couldn't prepare the invite. Tap again to retry.")
        notifyHaptic("error")
        return
      case "fallback":
        finish("Opening Telegram to share the invite…")
        return
      case "shared":
        finish("Invite shared — the coach can start onboarding")
    }
  }

  /**
   * The email channel's whole flow, waiting on its sender (#105). Everything
   * the manager sees is real; the delivery behind it is not yet, so the sheet
   * closes and says so rather than pretending an invite went out. Nothing is
   * created — no workspace, no invite, no delivery — which is why this path
   * never touches the create mutation.
   */
  const sendByEmail = async (delivery: { readonly email: string }) => {
    const notice = await sendCoachInviteEmail({ requestId, name, language, ...delivery })
    setEmailOpen(false)
    notifyHaptic("warning")
    // Toasted rather than shown in the sheet: the sheet is gone by then, and
    // the answer belongs to the screen the manager is left looking at.
    toast.add({ title: notice, type: "info" })
  }

  const copyInvite = async () => {
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
    setCreated(true)
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

  const copyFallbackDirect = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message)
    } catch {
      setCopyError("Copy is blocked here — long-press the message and copy it manually.")
      notifyHaptic("error")
      return
    }
    finish("Invite copied — paste it to the coach")
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pt-6 pb-10">
      <TelegramBackButton onBack={() => void navigate({ to: "/admin" })} />

      <header className="mt-7">
        <h1 className="text-display font-semibold tracking-tight">Invite a coach</h1>
        <p className="text-muted-foreground mt-2 text-body leading-5">
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
          disabled={created}
          onChange={setName}
          onBlur={() => undefined}
        />
        <p className="text-muted-foreground mt-2 text-caption">
          Only labels the invite in your list until they join.
        </p>
      </div>

      {/* Above the actions, not inside them: whichever channel the invite leaves
          through, this is the language the coach's setup will speak (#164). */}
      <InviteLanguageChips
        className="mt-7"
        value={language}
        disabled={pending}
        onChange={setLanguage}
      />

      <h2 className="text-muted-foreground mt-8 text-caption font-semibold tracking-widest uppercase">
        Send the invite
      </h2>
      <Card className="divide-border mt-3 gap-0 divide-y overflow-hidden py-0">
        <InviteAction
          icon={<HugeiconsIcon icon={TelegramIcon} size={22} strokeWidth={1.8} />}
          title="Send in Telegram"
          subtitle="Pick a chat — the coach gets a ready-to-tap invite"
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
            setEmailOpen(true)
          }}
        />
        <InviteAction
          icon={<HugeiconsIcon icon={Copy01Icon} size={22} strokeWidth={1.8} />}
          title="Copy invite"
          subtitle="Paste anywhere — WhatsApp, Slack, SMS"
          disabled={pending}
          onClick={() => {
            setActionError(undefined)
            setCopyError(undefined)
            setCopyFallback(undefined)
            setCopyOpen(true)
          }}
        />
      </Card>

      {actionError === undefined ? null : (
        <Alert variant="destructive" className="bg-destructive/10 mt-4 border-transparent">
          <AlertDescription className="text-destructive">{actionError}</AlertDescription>
        </Alert>
      )}

      {pending ? (
        <p className="text-muted-foreground mt-4 flex items-center gap-2 text-body">
          <Spinner /> Preparing the invite…
        </p>
      ) : null}

      <p className="text-muted-foreground mt-auto border-t pt-4 text-caption leading-5">
        The link works once and expires in 7 days. You can resend it anytime.
      </p>

      <InviteEmailSheet
        open={emailOpen}
        onOpenChange={setEmailOpen}
        onSend={(delivery) => void sendByEmail(delivery)}
      />

      <InviteCopySheet
        open={copyOpen}
        onOpenChange={setCopyOpen}
        pending={pending}
        error={copyError}
        fallbackMessage={copyFallback}
        onCopy={() => void copyInvite()}
        onCopyFallback={(message) => void copyFallbackDirect(message)}
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
    <Item
      render={<button type="button" disabled={disabled} onClick={onClick} />}
      className="hover:bg-muted active:bg-accent/70 min-h-[70px] w-full rounded-none border-0 text-left transition-colors disabled:opacity-60"
    >
      <ItemMedia>
        <span className="border-primary/50 text-primary flex size-11 items-center justify-center rounded-full border">
          {icon}
        </span>
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="font-medium">{title}</ItemTitle>
        <ItemDescription className="text-caption leading-4">{subtitle}</ItemDescription>
      </ItemContent>
    </Item>
  )
}
