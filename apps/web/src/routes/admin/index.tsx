import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo } from "react"

import { AdminHero } from "@/components/admin-hero.tsx"
import { TelegramMainButton } from "@/components/telegram-main-button.tsx"
import { toast } from "@/components/ui/toast.tsx"
import { takeAdminNotice } from "@/features/admin/admin-notice.ts"
import {
  CoachListCard,
  CoachListEmpty,
  CoachRow,
  InviteCoachLink,
  ViewerCoachCard,
} from "@/features/admin/components/coach-list.tsx"
import { Section, SectionTitle } from "@/features/mini-app/components/section.tsx"
import { adminWorkspaceListQuery } from "@/features/admin/workspace-queries.ts"
import { openTelegramLink } from "@/lib/telegram.ts"

export const Route = createFileRoute("/admin/")({ component: AdminHome })
const adminRoute = getRouteApi("/admin")

// Admin copy is English-only (admin-surface.md): the admin is the solo operator,
// so the trilingual machinery that serves coaches never reaches these routes.
function AdminHome() {
  const { coach: viewerCoach } = adminRoute.useLoaderData()
  const { data } = useSuspenseQuery(adminWorkspaceListQuery())
  const navigate = useNavigate()
  const openInvite = useCallback(() => void navigate({ to: "/admin/workspaces/new" }), [navigate])

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

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-14 pb-10">
      <AdminHero />

      {viewerCoach === null ? null : (
        <div className="mt-10">
          <ViewerCoachCard
            viewerCoach={viewerCoach}
            onOpen={(link) => void openTelegramLink(link)}
          />
        </div>
      )}

      {onboarding.length === 0 ? null : (
        <Section className="mt-10" aria-labelledby="onboarding-heading">
          <SectionTitle id="onboarding-heading">Setting up</SectionTitle>
          <p className="text-muted-foreground mt-2 px-1 text-body">
            Invites and coaches who haven&rsquo;t finished onboarding.
          </p>
          <div className="mt-4">
            <CoachListCard>
              {onboarding.map((coach) => (
                <CoachRow key={coach.id} coach={coach} />
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
            {/* Inviting is the screen's action, not one of its rows: as a row
                it sat below however many coaches happened to be onboarding,
                which is the one thing here that should never move. The host's
                bottom button gives it a fixed place outside the scroll; a
                browser with no Telegram host keeps the row. */}
            <TelegramMainButton
              text="Invite a coach"
              onClick={openInvite}
              fallback={<InviteCoachLink />}
            />
            {data.coaches.length === 0 ? (
              <CoachListEmpty />
            ) : (
              active.map((coach) => <CoachRow key={coach.id} coach={coach} />)
            )}
          </CoachListCard>
        </div>
      </Section>
    </main>
  )
}
