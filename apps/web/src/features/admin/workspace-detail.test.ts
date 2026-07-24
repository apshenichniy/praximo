import { describe, expect, it } from "vitest"

import {
  detailSubtitle,
  detailVariant,
  inviteChannel,
  inviteHeadline,
  onboardingSteps,
  reissueCopy,
  type WorkspaceDetail,
} from "./workspace-detail.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

const workspace = (overrides: Partial<WorkspaceDetail>): WorkspaceDetail =>
  ({
    id: "ws_test",
    name: "Ada",
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    botStatus: "awaiting-setup",
    canReissue: true,
    ...overrides,
  }) as WorkspaceDetail

const invite = (
  overrides: Partial<NonNullable<WorkspaceDetail["invite"]>> = {},
): NonNullable<WorkspaceDetail["invite"]> => ({
  id: "ci_test",
  status: "pending",
  issuedAt: "2026-07-20T10:00:00.000Z",
  expiresAt: "2026-07-27T10:00:00.000Z",
  ...overrides,
})

describe("detailVariant", () => {
  it("switches on the onboarding stage the server resolved, not on the bot status", () => {
    expect(detailVariant(workspace({ botStatus: "connected" }))).toBe("active")
    // A connected bot whose coach has not accepted the terms is still onboarding.
    expect(detailVariant(workspace({ botStatus: "connected", onboarding: "bot-connected" }))).toBe(
      "onboarding",
    )
  })
})

describe("detailSubtitle", () => {
  it("distinguishes moving, stopped, and never-started onboarding", () => {
    expect(detailSubtitle(workspace({}))).toBe("Active coach")
    expect(detailSubtitle(workspace({ onboarding: "invited" }))).toBe("Onboarding in progress")
    expect(detailSubtitle(workspace({ onboarding: "expired" }))).toBe("Onboarding stopped")
    expect(detailSubtitle(workspace({ onboarding: "not-invited" }))).toBe("No invite yet")
  })
})

describe("inviteHeadline", () => {
  it("counts down only while the invite is still measured by its expiry", () => {
    const sent = inviteHeadline(
      workspace({
        onboarding: "invited",
        invite: invite({ expiresAt: new Date(Date.now() + 3.5 * 86_400_000).toISOString() }),
      }),
    )

    expect(sent.title).toBe("Invite sent")
    expect(sent.detail).toContain("expires in 3d")
  })

  it("says the deadline is gone once the claim is accepted (#112)", () => {
    const accepted = inviteHeadline(
      workspace({
        onboarding: "accepted",
        invite: invite({ status: "accepted", acceptedAt: "2026-07-21T10:00:00.000Z" }),
      }),
    )

    expect(accepted.title).toBe("Link opened")
    expect(accepted.detail).toContain("no longer expires")
    expect(accepted.detail).not.toContain("expires in")
  })

  it("names every terminal end differently, so history is not flattened", () => {
    const titles = (["expired", "declined", "reset", "not-invited"] as const).map(
      (stage) => inviteHeadline(workspace({ onboarding: stage, invite: invite() })).title,
    )

    expect(new Set(titles).size).toBe(titles.length)
  })

  it("survives an invite whose timestamps the payload never carried", () => {
    const headline = inviteHeadline(workspace({ onboarding: "declined" }))

    expect(headline.detail).toContain("declined")
    expect(headline.detail).not.toContain("undefined")
    expect(headline.detail).not.toContain("Invalid Date")
  })
})

describe("onboardingSteps", () => {
  it("advances exactly one step per lifecycle stage", () => {
    const states = (stage: AdminSurface.CoachOnboardingStage) =>
      onboardingSteps(workspace({ onboarding: stage })).map((step) => step.state)

    expect(states("invited")).toEqual(["current", "upcoming", "upcoming"])
    expect(states("accepted")).toEqual(["done", "current", "upcoming"])
    expect(states("stalled")).toEqual(["done", "current", "upcoming"])
    expect(states("bot-connected")).toEqual(["done", "done", "current"])
  })

  it("blocks the first step for a terminal invite — nothing moves until reissue", () => {
    expect(onboardingSteps(workspace({ onboarding: "expired" }))[0]?.state).toBe("blocked")
    expect(onboardingSteps(workspace({ onboarding: "declined" }))[0]?.state).toBe("blocked")
  })
})

describe("reissueCopy", () => {
  it("warns about lost progress only when a claim actually exists to lose", () => {
    expect(reissueCopy(workspace({ onboarding: "accepted" })).description).toContain("start over")
    expect(reissueCopy(workspace({ onboarding: "stalled" })).description).toContain("start over")
    expect(reissueCopy(workspace({ onboarding: "expired" })).description).not.toContain(
      "start over",
    )
  })
})

describe("inviteChannel", () => {
  it("reads as a standalone value and admits when nothing was recorded", () => {
    expect(inviteChannel(invite({ channel: "telegram" }))).toBe("Telegram")
    expect(inviteChannel(invite({ channel: "copy" }))).toBe("Copied link")
    expect(inviteChannel(invite())).toBe("Not recorded")
    expect(inviteChannel(undefined)).toBe("Not recorded")
  })
})
