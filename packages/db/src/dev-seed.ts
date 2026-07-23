import { Effect } from "effect"
import { Database, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

/**
 * Deterministic fixtures for the admin workspace list. These ids are reserved
 * for local/dev reset data; the seed only runs after the reset has rebuilt an
 * empty schema.
 */
export const demoWorkspaces = [
  {
    id: "ws_dev_fixture_praximo_lab",
    name: "Praximo Lab",
  },
  {
    id: "ws_dev_fixture_north_star",
    name: "North Star Coaching",
    owner: {
      id: "mem_dev_fixture_north_star",
      language: "en" as const,
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
      language: "en" as const,
      avatarR2Key: null,
    },
    bot: {
      connectionStatus: "needs_relink",
      username: "quiet_harbor_demo_bot",
      token: null,
    },
  },
] as const

/** Seed the three UI fixtures after a guarded dev reset. */
export const seedDemoWorkspaces = Effect.fn("DevSeed.seedDemoWorkspaces")(function* () {
  const { client } = yield* Database.Service

  yield* Effect.tryPromise({
    try: () =>
      client.insert(schema.workspace).values(demoWorkspaces.map(({ id, name }) => ({ id, name }))),
    catch: (cause) => new QueryFailed({ operation: "seedDemoWorkspaces.workspaces", cause }),
  })

  yield* Effect.tryPromise({
    try: () =>
      client.insert(schema.member).values(
        demoWorkspaces.flatMap((workspace) =>
          "owner" in workspace
            ? [
                {
                  ...workspace.owner,
                  workspaceId: workspace.id,
                  role: "owner",
                },
              ]
            : [],
        ),
      ),
    catch: (cause) => new QueryFailed({ operation: "seedDemoWorkspaces.members", cause }),
  })

  yield* Effect.tryPromise({
    try: () =>
      client.insert(schema.bot).values(
        demoWorkspaces.flatMap((workspace) =>
          "bot" in workspace
            ? [
                {
                  ...workspace.bot,
                  workspaceId: workspace.id,
                },
              ]
            : [],
        ),
      ),
    catch: (cause) => new QueryFailed({ operation: "seedDemoWorkspaces.bots", cause }),
  })
})

export * as DevSeed from "./dev-seed.ts"
