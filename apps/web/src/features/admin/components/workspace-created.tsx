import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button.tsx"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { InviteLinkPanel } from "@/features/admin/components/invite-link-panel.tsx"
import { useCopyLink } from "@/features/admin/hooks/use-copy-link.ts"
import { resendAdminWorkspaceInvite } from "@/server/admin-workspaces.functions.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

const deliveryCopy = (delivery: AdminSurface.DeliveryStatus): string =>
  delivery === "sent"
    ? "The onboarding message was sent to the manager chat."
    : delivery === "failed"
      ? "Workspace created, but Telegram delivery failed."
      : "Workspace already existed. Check delivery before sending again."

export function WorkspaceCreatedScreen({
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
  const [resendWarning, setResendWarning] = useState(false)
  const copyController = useCopyLink(result.link)
  const resend = useMutation({
    mutationFn: () => resendAdminWorkspaceInvite({ data: { initData, inviteId: result.inviteId } }),
    onSuccess: (response) => {
      if (response.ok) onResultChange(response.value)
    },
  })

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pt-16 pb-10">
      <div className="admin-avatar shadow-primary/20 ring-primary/25 mx-auto flex size-20 items-center justify-center rounded-full shadow-2xl ring-1">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={40} strokeWidth={1.8} />
      </div>
      <h1 className="mt-7 text-center text-3xl font-semibold tracking-tight">Workspace created</h1>
      <p className="text-muted-foreground mt-3 text-center text-sm">
        {deliveryCopy(result.delivery)}
      </p>

      <Card size="sm" className="ring-primary/15 mt-9">
        <CardHeader>
          <CardTitle>One-time coach link</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteLinkPanel
            link={result.link}
            ariaLabel="One-time coach link"
            controller={copyController}
          />
          <p className="text-muted-foreground mt-2 text-xs">
            Expires {new Date(result.expiresAt).toLocaleString()}. Opening it does not consume it;
            successful bot provisioning does.
          </p>
          <Button
            size="lg"
            className="mt-4 h-12 w-full font-semibold"
            onClick={() => void copyController.copy()}
          >
            {copyController.copied ? "Copied" : "Copy link"}
          </Button>
        </CardContent>
      </Card>

      {result.delivery === "sent" ? null : (
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
          <Button
            variant="outline"
            size="lg"
            disabled={resend.isPending}
            aria-busy={resend.isPending || undefined}
            className="mt-3 h-12 w-full font-semibold"
            onClick={() => {
              if (!resendWarning) {
                setResendWarning(true)
                return
              }
              resend.mutate()
            }}
          >
            {resend.isPending ? (
              <>
                <Spinner /> Sending…
              </>
            ) : resendWarning ? (
              "Send again anyway"
            ) : (
              "Try sending again"
            )}
          </Button>
        </section>
      )}

      <Button size="lg" className="mt-auto h-13 w-full font-semibold" onClick={onDone}>
        Done
      </Button>
    </main>
  )
}
