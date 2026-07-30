import { describe, expect, it } from "vitest"

import { SessionScreen } from "@/features/coach/components/session-screen.tsx"
import { coachCatalog, coachCopy } from "@/features/i18n/coach-copy.ts"
import type { CoachSessions } from "@/server/coach-sessions.ts"
import { renderScreen as render } from "./render-screen.tsx"

/**
 * The session screen (#62): the facts from #61, what became of the session, and
 * the two things a coach can do to it.
 *
 * Most of what this suite pins is **absence** — the state row that stays quiet
 * on an ordinary session, the actions that disappear once there is nothing left
 * to act on, and the no-show control that must never exist.
 */
const session = (
  overrides: Partial<CoachSessions.SessionDetail> = {},
): CoachSessions.SessionDetail => ({
  id: "se_1",
  clientId: "cl_1",
  clientName: "Maria K.",
  scheduledAt: "2026-07-27T11:00:00.000Z",
  durationMinutes: 60,
  kind: "regular",
  clientAccepted: true,
  timezone: "Europe/Kyiv",
  state: "scheduled",
  ...overrides,
})

const screen = (overrides: Partial<CoachSessions.SessionDetail> = {}, locale: "en" | "ru" = "en") =>
  render(
    <SessionScreen
      copy={coachCopy(locale)}
      language={locale}
      session={session(overrides)}
      onCancel={() => undefined}
      pending={false}
      error={undefined}
    />,
  )

describe("session screen", () => {
  it("carries the facts #61 already showed", async () => {
    const html = await screen()

    expect(html).toContain("Maria K.")
    expect(html).toContain("14:00")
    expect(html).toContain(coachCatalog.en.clients.kindRegular)
    expect(html).toContain("60")
    expect(html).toContain("/clients/cl_1")
  })

  it("names the invitation only when it is a problem", async () => {
    expect(await screen()).not.toContain(coachCatalog.en.sessions.detailInvitation)
    expect(await screen({ clientAccepted: false })).toContain(
      coachCatalog.en.sessions.detailUnaccepted,
    )
  })

  it("offers the two lifecycle actions on a scheduled session", async () => {
    const html = await screen()

    expect(html).toContain(coachCatalog.en.sessions.rescheduleAction)
    expect(html).toContain(coachCatalog.en.sessions.cancelAction)
    expect(html).toContain("/sessions/se_1/reschedule")
  })

  /**
   * The rule the invitation row already follows: an ordinary session says
   * nothing about itself, so the one that does is the one worth reading.
   */
  it("says nothing about the state of a scheduled session", async () => {
    const html = await screen()

    expect(html).not.toContain(coachCatalog.en.sessions.detailState)
    expect(html).not.toContain(coachCatalog.en.sessions.stateCompleted)
  })

  it("states what became of a session that is no longer scheduled", async () => {
    const completed = await screen({ state: "completed" })
    expect(completed).toContain(coachCatalog.en.sessions.detailState)
    expect(completed).toContain(coachCatalog.en.sessions.stateCompleted)

    const byCoach = await screen({ state: "cancelled", cancelReason: "coach_cancelled" })
    expect(byCoach).toContain(coachCatalog.en.sessions.stateCancelledByCoach)
  })

  /**
   * An automatic cancellation reads as what happened, never as an enum and never
   * as something the coach did wrong.
   */
  it("puts an automatic cancellation in plain words", async () => {
    const noShow = await screen({ state: "cancelled", cancelReason: "no_show" }, "ru")
    expect(noShow).toContain(coachCatalog.ru.sessions.stateCancelledNoShow)
    expect(noShow).not.toContain("no_show")

    const room = await screen({ state: "cancelled", cancelReason: "room_unavailable" }, "ru")
    expect(room).toContain(coachCatalog.ru.sessions.stateCancelledRoom)
    expect(room).not.toContain("room_unavailable")
  })

  it("offers nothing to do to a session that has already ended", async () => {
    for (const state of ["completed", "cancelled", "in_progress"] as const) {
      const html = await screen({ state })
      expect(html).not.toContain(coachCatalog.en.sessions.rescheduleAction)
      expect(html).not.toContain(coachCatalog.en.sessions.cancelAction)
      expect(html).not.toContain("/reschedule")
    }
  })

  /**
   * A standing decision from prototype #15, restated as a test because «mark
   * no-show» is the obvious thing to add to this screen and would be wrong:
   * terminal states other than `coach_cancelled` are the reconciler's alone
   * (ADR 0005).
   */
  it("offers no way to assert a no-show", async () => {
    for (const state of ["scheduled", "completed", "cancelled"] as const) {
      const html = (await screen({ state })).toLowerCase()
      expect(html).not.toContain("no-show")
      expect(html).not.toContain("no show")
    }
  })

  /** The fixed bottom slot is #42's; an action parked there would have to move. */
  it("leaves the host's bottom slot free", async () => {
    expect(await screen()).not.toContain("fixed inset-x-0 bottom-0")
  })
})
