import { describe, expect, it } from "vitest"

import {
  type DeletionProgress,
  deletionCardCopy,
  deletionConsequences,
  deletionGate,
  deletionHeadline,
  deletionAdvancing,
  deletionAdvancingLapsesInMs,
  deletionStages,
  lightConfirmCopy,
} from "./workspace-deletion.ts"
import type { WorkspaceDetail } from "./workspace-detail.ts"

const workspace = (overrides: Record<string, unknown>): WorkspaceDetail =>
  ({
    id: "ws_test",
    name: "Ada",
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    botStatus: "awaiting-setup",
    canReissue: true,
    ...overrides,
  }) as WorkspaceDetail

const invite = () => ({
  id: "ci_test",
  status: "pending",
  issuedAt: "2026-07-20T10:00:00.000Z",
  expiresAt: "2026-07-27T10:00:00.000Z",
})

const progress = (overrides: Partial<DeletionProgress> = {}): DeletionProgress => ({
  workspaceId: "ws_test" as DeletionProgress["workspaceId"],
  state: "prepared",
  pipeline: "pending",
  farewell: "pending",
  botRelease: "pending",
  startedAt: "2026-07-24T10:00:00.000Z",
  drivingLapsesInMs: 0,
  ...overrides,
})

const labels = (stages: ReadonlyArray<{ readonly label: string }>) =>
  stages.map((stage) => stage.label)

const states = (stages: ReadonlyArray<{ readonly state: string }>) =>
  stages.map((stage) => stage.state)

describe("deletionGate", () => {
  it("spends the two-sheet gate only where a bot exists to release", () => {
    expect(deletionGate(workspace({ botStatus: "connected" }))).toBe("guarded")
    expect(deletionGate(workspace({ botStatus: "needs-relink" }))).toBe("guarded")
    expect(deletionGate(workspace({ botStatus: "awaiting-setup" }))).toBe("light")
  })

  it("keeps the light gate for a claimed invite that never got a bot", () => {
    expect(deletionGate(workspace({ invite: { ...invite(), status: "accepted" } }))).toBe("light")
  })
})

describe("deletionConsequences", () => {
  it("names the bot and the coach it is taking Praximo away from", () => {
    expect(
      deletionConsequences(workspace({ botStatus: "connected", botUsername: "ada_coach_bot" })),
    ).toEqual([
      "Bot @ada_coach_bot will be released",
      "Ada loses access to Praximo",
      "All clients, sessions, transcripts and artifacts will be purged",
      "This cannot be undone",
    ])
  })

  it("falls back to unnamed prose rather than an empty promise", () => {
    expect(deletionConsequences(workspace({ name: "", botStatus: "connected" }))).toEqual([
      "The connected bot will be released",
      "The coach loses access to Praximo",
      "All clients, sessions, transcripts and artifacts will be purged",
      "This cannot be undone",
    ])
  })
})

describe("lightConfirmCopy", () => {
  it("never promises to revoke an invite that was never issued", () => {
    expect(lightConfirmCopy(workspace({})).title).toBe("Delete this workspace?")
    expect(lightConfirmCopy(workspace({ invite: invite() })).title).toBe(
      "Delete invite and workspace?",
    )
  })
})

describe("deletionCardCopy", () => {
  it("promises exactly as much as the gate behind the button", () => {
    expect(deletionCardCopy(workspace({ botStatus: "connected" })).description).toContain(
      "Releases the bot",
    )
    expect(deletionCardCopy(workspace({ botStatus: "connected" })).title).toBe(
      "Delete workspace permanently",
    )
    expect(deletionCardCopy(workspace({})).description).toContain("No bot")
  })
})

describe("deletionStages", () => {
  it("reads each stage's own settled outcome", () => {
    expect(
      labels(
        deletionStages(
          progress({ pipeline: "nothing-active", farewell: "sent", botRelease: "not-connected" }),
          false,
        ),
      ),
    ).toEqual([
      "No active sessions",
      "Farewell message sent",
      "No bot to release",
      "Purge workspace data",
    ])
  })

  it("spins only the first unsettled stage, and only while an attempt is in flight", () => {
    const settled = progress({ pipeline: "cancelled" })
    expect(states(deletionStages(settled, true))).toEqual(["done", "running", "pending", "pending"])
    // Nobody driving it: the pipeline never advances on its own, so an
    // abandoned receipt has a pending next stage rather than a spinning one.
    expect(states(deletionStages(settled, false))).toEqual([
      "done",
      "pending",
      "pending",
      "pending",
    ])
  })

  it("shows the first stage running before the first receipt has been read back", () => {
    // The attempt is already in flight; the alternative is a blank sheet.
    expect(states(deletionStages(undefined, true))).toEqual([
      "running",
      "pending",
      "pending",
      "pending",
    ])
  })

  it("treats the completed receipt as the purge having landed", () => {
    const done = deletionStages(
      progress({
        state: "completed",
        pipeline: "cancelled",
        farewell: "undeliverable",
        botRelease: "released",
      }),
      false,
    )
    // The farewell never reached the coach, so it is flagged rather than ticked.
    expect(states(done)).toEqual(["done", "warned", "done", "done"])
    expect(labels(done)).toEqual([
      "Sessions cancelled",
      "Farewell could not be delivered",
      "Bot released",
      "Workspace data purged",
    ])
  })
})

describe("deletionHeadline", () => {
  it("distinguishes a running deletion from a paused one", () => {
    expect(deletionHeadline(progress(), true).title).toBe("Deleting workspace…")
    expect(deletionHeadline(progress(), true).description).toContain("continues in the background")
    expect(deletionHeadline(progress(), false).title).toBe("Deletion paused")
    expect(deletionHeadline(progress({ state: "completed" }), false).title).toBe(
      "Workspace deleted",
    )
  })

  it("calls the moment before the first receipt a deletion starting, not an absent one", () => {
    expect(deletionHeadline(undefined, false).title).toBe("Deleting workspace…")
  })
})

describe("deletionAdvancing", () => {
  it("counts this screen's own request from the moment it is sent", () => {
    // The receipt is a round trip away; without this the button just pressed
    // would look idle for the whole first request.
    expect(deletionAdvancing(undefined, true)).toBe(true)
    expect(deletionAdvancing(progress(), true)).toBe(true)
  })

  it("reads a held driver lease as a pipeline someone else is driving", () => {
    expect(deletionAdvancing(progress({ drivingLapsesInMs: 42_000 }), false)).toBe(true)
    expect(deletionAdvancing(progress({ drivingLapsesInMs: 0 }), false)).toBe(false)
  })

  it("never calls a finished deletion advancing", () => {
    expect(
      deletionAdvancing(progress({ state: "completed", drivingLapsesInMs: 42_000 }), false),
    ).toBe(false)
  })
})

describe("deletionAdvancingLapsesInMs", () => {
  it("says when the lease will stop vouching for a moving pipeline", () => {
    expect(deletionAdvancingLapsesInMs(progress({ drivingLapsesInMs: 15_000 }))).toBe(15_000)
    expect(deletionAdvancingLapsesInMs(progress())).toBe(0)
    expect(
      deletionAdvancingLapsesInMs(progress({ state: "completed", drivingLapsesInMs: 15_000 })),
    ).toBe(0)
    expect(deletionAdvancingLapsesInMs(undefined)).toBe(0)
  })
})
