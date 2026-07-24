import { describe, expect, it } from "vitest"

import {
  detailStatus,
  detailVariant,
  inviteChannel,
  inviteExplanation,
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

describe("detailStatus", () => {
  it("names a coach exactly as the list row names them", () => {
    expect(detailStatus(workspace({ onboarding: "invited" }))).toMatchObject({
      label: "Invited",
      tone: "amber",
    })
    expect(detailStatus(workspace({ onboarding: "stalled" }))).toMatchObject({
      label: "Setup stalled",
      tone: "amber",
    })
  })

  it("falls back to the bot's connection once onboarding is complete", () => {
    expect(detailStatus(workspace({ botStatus: "connected" }))).toMatchObject({
      label: "Connected",
      tone: "emerald",
    })
    expect(detailStatus(workspace({ botStatus: "needs-relink" }))).toMatchObject({
      label: "Needs re-link",
      tone: "rose",
    })
  })

  it("carries an icon for every state it can report", () => {
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
    for (const stage of stages) {
      expect(detailStatus(workspace({ onboarding: stage })).icon).toBeDefined()
    }
    expect(detailStatus(workspace({ botStatus: "connected" })).icon).toBeDefined()
  })
})

describe("inviteExplanation", () => {
  it("counts down only while the invite is still measured by its expiry", () => {
    const sent = inviteExplanation(
      workspace({
        onboarding: "invited",
        invite: invite({ expiresAt: new Date(Date.now() + 3.5 * 86_400_000).toISOString() }),
      }),
    )

    expect(sent).toContain("expires in 3d")
  })

  it("says the deadline is gone once the claim is accepted (#112)", () => {
    const accepted = inviteExplanation(
      workspace({
        onboarding: "accepted",
        invite: invite({ status: "accepted", acceptedAt: "2026-07-21T10:00:00.000Z" }),
      }),
    )

    expect(accepted).toContain("no longer expires")
    expect(accepted).not.toContain("expires in")
  })

  it("explains every terminal end differently, so history is not flattened", () => {
    const texts = (["expired", "declined", "reset", "not-invited"] as const).map((stage) =>
      inviteExplanation(workspace({ onboarding: stage, invite: invite() })),
    )

    expect(new Set(texts).size).toBe(texts.length)
  })

  it("survives an invite whose timestamps the payload never carried", () => {
    const text = inviteExplanation(workspace({ onboarding: "declined" }))

    expect(text).toContain("declined")
    expect(text).not.toContain("undefined")
    expect(text).not.toContain("Invalid Date")
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
