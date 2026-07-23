import { describe, expect, it } from "vitest"
import { demoWorkspaces } from "./dev-seed.ts"

describe("demo workspace seed contract", () => {
  it("contains exactly the three deterministic safe UI fixtures", () => {
    expect(demoWorkspaces).toEqual([
      {
        id: "ws_dev_fixture_praximo_lab",
        name: "Praximo Lab",
      },
      {
        id: "ws_dev_fixture_north_star",
        name: "North Star Coaching",
        owner: {
          id: "mem_dev_fixture_north_star",
          language: "en",
          avatarR2Key: null,
        },
        bot: {
          connectionStatus: "pending",
          token: null,
        },
      },
      {
        id: "ws_dev_fixture_quiet_harbor",
        name: "Quiet Harbor",
        owner: {
          id: "mem_dev_fixture_quiet_harbor",
          language: "en",
          avatarR2Key: null,
        },
        bot: {
          connectionStatus: "needs_relink",
          username: "quiet_harbor_demo_bot",
          token: null,
        },
      },
    ])

    expect(
      demoWorkspaces.some(
        (workspace) => "bot" in workspace && String(workspace.bot.connectionStatus) === "connected",
      ),
    ).toBe(false)
  })
})
