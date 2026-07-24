import { afterEach, describe, expect, it, vi } from "vitest"
import { onboardingDescription, viewerCoachAction } from "./coach-progress.ts"

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

describe("onboardingDescription", () => {
  it("names the delivery channel and the remaining time while invited", () => {
    freezeClock()

    expect(
      onboardingDescription({ stage: "invited", channel: "telegram", expiresAt: inHours(3 * 24) }),
    ).toBe("Invited via Telegram · expires in 3d")
    expect(
      onboardingDescription({ stage: "invited", channel: "email", expiresAt: inHours(0.5) }),
    ).toBe("Invited via email · expires today")
    // An invite with no recorded delivery still reads as an invite.
    expect(onboardingDescription({ stage: "invited", expiresAt: inHours(24) })).toBe(
      "Invited · expires in 1d",
    )
  })

  it("reports an accepted claim by when it was claimed, never by an expiry", () => {
    freezeClock()

    expect(onboardingDescription({ stage: "accepted", acceptedAt: hoursAgo(2) })).toBe(
      "Accepted 2 hours ago · setup in progress",
    )
    expect(onboardingDescription({ stage: "stalled", acceptedAt: hoursAgo(48) })).toBe(
      "Accepted 2 days ago · still incomplete",
    )
  })

  it("distinguishes a coach decline from an admin reset", () => {
    freezeClock()

    expect(onboardingDescription({ stage: "declined", cancelledAt: hoursAgo(24) })).toBe(
      "Invitation declined yesterday",
    )
    expect(onboardingDescription({ stage: "reset", cancelledAt: hoursAgo(24) })).toBe(
      "Invitation reset yesterday",
    )
  })

  it("covers the remaining stages without leaning on a timestamp", () => {
    freezeClock()

    expect(onboardingDescription({ stage: "bot-connected" })).toBe(
      "Bot connected · waiting for first login and terms",
    )
    expect(onboardingDescription({ stage: "expired" })).toBe("The invite reached its expiry")
    expect(onboardingDescription({ stage: "not-invited" })).toBe("No invite has been issued")
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
