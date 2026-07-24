import { afterEach, describe, expect, it, vi } from "vitest"
import type { AdminSurface } from "@/server/admin-surface.ts"
import { coachRowState, coachRowTime, viewerCoachAction } from "./coach-progress.ts"

const NOW = Date.parse("2026-07-24T12:00:00.000Z")
const inHours = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString()
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString()

const freezeClock = () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
}

afterEach(() => {
  vi.useRealTimers()
})

const coach = (overrides: Partial<AdminSurface.CoachListEntry>): AdminSurface.CoachListEntry =>
  ({
    id: "ws_row",
    name: "Ada Lovelace",
    botStatus: "awaiting-setup",
    ...overrides,
  }) as AdminSurface.CoachListEntry

const onboarding = (stage: AdminSurface.CoachOnboardingStage, rest?: Record<string, string>) =>
  coach({ onboarding: { stage, ...rest } as AdminSurface.CoachOnboarding })

describe("coachRowState", () => {
  it("describes a finished coach by their bot and everyone else by the invite", () => {
    expect(coachRowState(coach({ botStatus: "connected" }))).toEqual({
      label: "Connected",
      tone: "emerald",
    })
    expect(coachRowState(coach({ botStatus: "needs-relink" }))).toEqual({
      label: "Needs re-link",
      tone: "rose",
    })
    expect(coachRowState(onboarding("stalled"))).toEqual({ label: "Setup stalled", tone: "amber" })
    // Terminal history recedes rather than alarming: nothing is owed on it.
    expect(coachRowState(onboarding("declined")).tone).toBe("muted")
  })

  it("names every stage, so the colour never has to carry the state alone", () => {
    const stages: ReadonlyArray<AdminSurface.CoachOnboardingStage> = [
      "invited",
      "accepted",
      "stalled",
      "bot-connected",
      "expired",
      "declined",
      "reset",
      "not-invited",
    ]
    const labels = stages.map((stage) => coachRowState(onboarding(stage)).label)

    expect(labels.every((label) => label.length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(stages.length)
  })
})

describe("coachRowTime", () => {
  it("counts down only while the invite is pending", () => {
    freezeClock()

    expect(coachRowTime(onboarding("invited", { expiresAt: inHours(3 * 24) }))).toBe(
      "expires in 3d",
    )
    // Acceptance retires the TTL, so the row reports the claim, not a deadline.
    expect(
      coachRowTime(onboarding("accepted", { acceptedAt: hoursAgo(2), expiresAt: inHours(5 * 24) })),
    ).toBe("2 hours ago")
  })

  it("names the event when the state word and the timestamp differ", () => {
    freezeClock()

    expect(coachRowTime(onboarding("stalled", { acceptedAt: hoursAgo(48) }))).toBe(
      "accepted 2 days ago",
    )
    expect(coachRowTime(onboarding("bot-connected", { acceptedAt: hoursAgo(26) }))).toBe(
      "accepted yesterday",
    )
    // The word already says "Declined", so the time needs no noun of its own.
    expect(coachRowTime(onboarding("declined", { cancelledAt: hoursAgo(24) }))).toBe("yesterday")
  })

  it("reports activity for a finished coach, and says so when there is none", () => {
    freezeClock()

    expect(coachRowTime(coach({ botStatus: "connected", lastActivityAt: hoursAgo(2) }))).toBe(
      "active 2 hours ago",
    )
    expect(coachRowTime(coach({ botStatus: "connected" }))).toBe("no activity yet")
  })

  it("omits the timestamp when the stage has no time to report", () => {
    freezeClock()

    expect(coachRowTime(onboarding("not-invited"))).toBeUndefined()
    expect(coachRowTime(onboarding("accepted"))).toBeUndefined()
  })
})

describe("viewerCoachAction", () => {
  it("offers a resume while onboarding and an open once active", () => {
    const workspaceId = "ws_mine" as never

    expect(
      viewerCoachAction({ state: "accepted", workspaceId, link: "https://t.me/bot" }).title,
    ).toBe("Continue my coach setup")
    expect(
      viewerCoachAction({ state: "bot-connected", workspaceId, link: "https://t.me/bot" }).title,
    ).toBe("Continue my coach setup")
    expect(
      viewerCoachAction({ state: "active", workspaceId, link: "https://t.me/bot" }).title,
    ).toBe("Open my coach bot")
  })
})
