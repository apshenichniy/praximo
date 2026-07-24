import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"

import { AdminHero } from "@/components/admin-hero.tsx"
import { toast } from "@/components/ui/toast.tsx"
import { takeAdminNotice } from "@/features/admin/admin-notice.ts"
import {
  type CoachEntry,
  ActiveCoachItem,
  CoachListCard,
  CoachListEmpty,
  InviteCoachLink,
  OnboardingCoachItem,
  ViewerCoachCard,
} from "@/features/admin/components/coach-list.tsx"
import { Section, SectionTitle } from "@/features/admin/components/section.tsx"
import { notifyHaptic } from "@/features/admin/haptics.ts"
import { useInviteShare } from "@/features/admin/hooks/use-invite-share.ts"
import { adminWorkspaceListQuery } from "@/features/admin/workspace-queries.ts"
import { loadTelegramWebApp } from "@/lib/telegram.ts"

export const Route = createFileRoute("/admin/")({ component: AdminHome })
const adminRoute = getRouteApi("/admin")

/** How long a row keeps saying "Copied" before falling back to its label. */
const CopiedFeedbackMilliseconds = 2_000

/**
 * Open a `t.me` link without leaving the Mini App. Outside a Telegram host
 * (local browser development) there is no bridge, so the link opens normally.
 */
const openInTelegram = async (link: string) => {
  const webApp = await loadTelegramWebApp()
  if (webApp === undefined) {
    window.open(link, "_blank", "noopener,noreferrer")
    return
  }
  webApp.openTelegramLink(link)
}

// Admin copy is English-only (admin-surface.md): the admin is the solo operator,
// so the trilingual machinery that serves coaches never reaches these routes.
function AdminHome() {
  const { initData } = adminRoute.useLoaderData()
  const { data } = useSuspenseQuery(adminWorkspaceListQuery(initData))
  const [copiedId, setCopiedId] = useState<string>()
  const inviteShare = useInviteShare(initData)

  // The server already returns onboarding first and active coaches A→Z; the
  // split here is only about which heading each row lives under.
  const { onboarding, active } = useMemo(
    () => ({
      onboarding: data.coaches.filter((coach) => coach.onboarding !== undefined),
      active: data.coaches.filter((coach) => coach.onboarding === undefined),
    }),
    [data.coaches],
  )

  useEffect(() => {
    const message = takeAdminNotice()
    if (message === undefined) return
    // Deferred a tick: on a fresh page load this child effect runs before the
    // layout's Toaster has subscribed, and an immediate add would be dropped.
    // Deliberately not cancelled on cleanup — the notice is consumed above, so
    // a StrictMode re-run cannot re-read it and would lose the toast entirely.
    setTimeout(() => toast.add({ title: message, type: "success" }), 0)
  }, [])

  /**
   * Re-deliver a live invite through Telegram's native chat picker — the same
   * prepared-message path the invite screen uses (#104). The invite itself is
   * untouched: a dismissed picker changes nothing and the link stays valid.
   */
  const resend = async (coach: CoachEntry) => {
    const actions = coach.onboarding?.actions
    if (actions === undefined) return

    switch (await inviteShare.share({ ...actions, inviteId: actions.id })) {
      case "dismissed":
        return
      case "no-telegram":
        notifyHaptic("error")
        toast.add({ title: "Open this from Telegram to resend the invite.", type: "error" })
        return
      case "failed":
        notifyHaptic("error")
        toast.add({ title: "Telegram couldn't prepare the invite. Try again.", type: "error" })
        return
      case "fallback":
        notifyHaptic("success")
        toast.add({ title: "Opening Telegram to share the invite…", type: "success" })
        return
      case "shared":
        notifyHaptic("success")
        toast.add({ title: "Invite sent again", type: "success" })
    }
  }

  const copy = async (coach: CoachEntry) => {
    const actions = coach.onboarding?.actions
    if (actions === undefined) return
    try {
      await navigator.clipboard.writeText(actions.message)
    } catch {
      notifyHaptic("error")
      toast.add({
        title: "Copy is blocked here — open the coach to copy the invite.",
        type: "error",
      })
      return
    }
    setCopiedId(coach.id)
    setTimeout(() => setCopiedId(undefined), CopiedFeedbackMilliseconds)
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-14 pb-10">
      <AdminHero />

      {data.viewerCoach === undefined ? null : (
        <div className="mt-10">
          <ViewerCoachCard
            viewerCoach={data.viewerCoach}
            onOpen={(link) => void openInTelegram(link)}
          />
        </div>
      )}

      {onboarding.length === 0 ? null : (
        <Section className="mt-10" aria-labelledby="onboarding-heading">
          <SectionTitle id="onboarding-heading">Setting up</SectionTitle>
          <p className="text-muted-foreground mt-2 px-1 text-sm">
            Invites and coaches who haven&rsquo;t finished onboarding.
          </p>
          <div className="mt-4">
            <CoachListCard>
              {onboarding.map((coach) => (
                <OnboardingCoachItem
                  key={coach.id}
                  coach={coach}
                  resending={inviteShare.sharingInviteId === coach.onboarding?.actions?.id}
                  copied={copiedId === coach.id}
                  onResend={(entry) => void resend(entry)}
                  onCopy={(entry) => void copy(entry)}
                />
              ))}
            </CoachListCard>
          </div>
        </Section>
      )}

      <Section
        className={onboarding.length === 0 ? "mt-10" : undefined}
        aria-labelledby="coaches-heading"
      >
        <SectionTitle id="coaches-heading">Coaches</SectionTitle>
        <div className="mt-4">
          <CoachListCard>
            <InviteCoachLink />
            {data.coaches.length === 0 ? (
              <CoachListEmpty />
            ) : (
              active.map((coach) => <ActiveCoachItem key={coach.id} coach={coach} />)
            )}
          </CoachListCard>
        </div>
      </Section>
    </main>
  )
}
