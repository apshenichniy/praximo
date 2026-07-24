import { CoachOnboardingInviteCodePattern } from "@praximo/domain"
import { describe, expect, it } from "vitest"
import { demoWorkspaces } from "./dev-seed.ts"

const invites = demoWorkspaces.flatMap((workspace) => workspace.invites ?? [])
/** The invite the coaches list renders from is the most recently issued one. */
const latestInvites = demoWorkspaces.flatMap((workspace) =>
  workspace.invites === undefined ? [] : [workspace.invites[workspace.invites.length - 1]],
)

describe("demo workspace seed contract", () => {
  it("covers every onboarding stage the coaches list can render", () => {
    const stages = new Set(latestInvites.map((invite) => invite?.status))
    expect(stages).toEqual(new Set(["pending", "accepted", "used", "expired", "cancelled"]))

    // Both cancellation reasons, so declined and reset copy are both visible.
    expect(new Set(invites.flatMap((invite) => invite.cancellationReason ?? []))).toEqual(
      new Set(["declined_by_coach", "reset_by_admin", "reissued"]),
    )
    // Every delivery channel, so the "Invited via …" line is exercised.
    expect(new Set(invites.flatMap((invite) => invite.delivery?.channel ?? []))).toEqual(
      new Set(["telegram", "email", "copy"]),
    )
    // A claim old enough to read as stalled, and a fresh one that does not.
    expect(invites.some((invite) => (invite.acceptedHoursAgo ?? 0) > 24)).toBe(true)
    expect(
      invites.some(
        (invite) =>
          invite.status === "accepted" &&
          invite.acceptedHoursAgo !== undefined &&
          invite.acceptedHoursAgo < 24,
      ),
    ).toBe(true)
    // A pending invite inside its last day, for the short-form countdown.
    expect(
      invites.some((invite) => invite.status === "pending" && invite.expiresInHours < 24),
    ).toBe(true)
    // A workspace that was never invited, and one claimed by the viewing admin.
    expect(demoWorkspaces.some((workspace) => workspace.invites === undefined)).toBe(true)
    expect(invites.some((invite) => invite.acceptedByViewer === true)).toBe(true)
  })

  it("covers connected, needs-relink, and not-yet-provisioned bots", () => {
    expect(
      new Set(demoWorkspaces.flatMap((workspace) => workspace.bot?.connectionStatus ?? [])),
    ).toEqual(new Set(["connected", "needs_relink"]))
    expect(demoWorkspaces.some((workspace) => workspace.bot === undefined)).toBe(true)
    // Onboarding complete versus bot-connected-but-not-activated.
    expect(
      demoWorkspaces.some(
        (workspace) =>
          workspace.bot !== undefined && workspace.owner?.termsAcceptedHoursAgo === undefined,
      ),
    ).toBe(true)
  })

  it("uses ids and codes that stay distinct and resolvable", () => {
    const ids = demoWorkspaces.map((workspace) => workspace.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith("ws_dev_fixture_"))).toBe(true)

    const inviteIds = invites.map((invite) => invite.id)
    expect(new Set(inviteIds).size).toBe(inviteIds.length)

    const codes = invites.map((invite) => invite.code)
    expect(new Set(codes).size).toBe(codes.length)
    // Codes must pass the bot's pre-database format filter, or the seeded deep
    // links would be rejected before they ever reach a lookup.
    expect(codes.every((code) => CoachOnboardingInviteCodePattern.test(code))).toBe(true)
  })

  it("never pretends a fixture bot can reach Telegram", () => {
    expect(demoWorkspaces.some((workspace) => "token" in (workspace.bot ?? {}))).toBe(false)
  })
})
