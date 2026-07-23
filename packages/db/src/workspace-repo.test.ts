import { describe, expect, it } from "@effect/vitest"
import { Workspace, WorkspaceId } from "@praximo/domain"
import { eq, inArray } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "./client.ts"
import * as schema from "./schema.ts"
import { WorkspaceRepo } from "./workspace-repo.ts"

/**
 * Repository seam tested against the dev Neon branch (slice #36). Skips entirely
 * when `DATABASE_URL` is absent, so `bun run test` stays green without secrets;
 * run `bun run db:reset` first to provision a clean, migrated branch.
 */
const DATABASE_URL = process.env.DATABASE_URL

const uniqueId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`

describe.skipIf(!DATABASE_URL)("WorkspaceRepo (dev Neon branch)", () => {
  const appLayer = Layer.provideMerge(WorkspaceRepo.layer, Database.testLayer(DATABASE_URL ?? ""))

  it.effect("round-trips a workspace it created", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceRepo.Service
      const { client } = yield* Database.Service
      const id = WorkspaceId.make(uniqueId("ws"))
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => client.delete(schema.workspace).where(eq(schema.workspace.id, id))),
      )

      yield* repo.create(Workspace.make({ id, name: "Ada's practice" }))
      const found = yield* repo.findById(id)

      expect(found.id).toBe(id)
      expect(found.name).toBe("Ada's practice")
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("reports WorkspaceNotFound for an unknown id instead of inventing one", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceRepo.Service
      const error = yield* Effect.flip(repo.findById(WorkspaceId.make(uniqueId("ws_missing"))))

      expect(error._tag).toBe("Domain.WorkspaceNotFound")
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("keeps two workspaces independent — one id never returns the other's row", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceRepo.Service
      const { client } = yield* Database.Service
      const first = WorkspaceId.make(uniqueId("ws"))
      const second = WorkspaceId.make(uniqueId("ws"))
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client
            .delete(schema.workspace)
            .where(eq(schema.workspace.id, first))
            .then(() => client.delete(schema.workspace).where(eq(schema.workspace.id, second))),
        ),
      )

      yield* repo.create(Workspace.make({ id: first, name: "First" }))
      yield* repo.create(Workspace.make({ id: second, name: "Second" }))

      expect((yield* repo.findById(first)).name).toBe("First")
      expect((yield* repo.findById(second)).name).toBe("Second")
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("lists every workspace once with normalized bot status and optional owner data", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceRepo.Service
      const { client } = yield* Database.Service
      const noBot = WorkspaceId.make(uniqueId("ws_no_bot"))
      const pending = WorkspaceId.make(uniqueId("ws_pending"))
      const connected = WorkspaceId.make(uniqueId("ws_connected"))
      const needsRelink = WorkspaceId.make(uniqueId("ws_needs_relink"))
      const ids = [noBot, pending, connected, needsRelink]

      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client.delete(schema.workspace).where(inArray(schema.workspace.id, ids)),
        ).pipe(Effect.asVoid),
      )

      yield* Effect.promise(() =>
        client.insert(schema.workspace).values([
          { id: noBot, name: "A No Bot" },
          { id: pending, name: "B Pending" },
          { id: connected, name: "C Connected", avatarR2Key: "avatars/a-owner.png" },
          { id: needsRelink, name: "D Needs Relink" },
        ]),
      )
      yield* Effect.promise(() =>
        client.insert(schema.member).values([
          {
            id: uniqueId("mem_pending"),
            workspaceId: pending,
            role: "owner",
            language: "en",
            avatarR2Key: null,
          },
          {
            id: uniqueId("mem_connected_first"),
            workspaceId: connected,
            role: "owner",
            language: "en",
            avatarR2Key: "avatars/z-owner.png",
          },
          {
            id: uniqueId("mem_connected_second"),
            workspaceId: connected,
            role: "owner",
            language: "en",
            avatarR2Key: "avatars/a-owner.png",
          },
        ]),
      )
      yield* Effect.promise(() =>
        client.insert(schema.bot).values([
          { workspaceId: pending, connectionStatus: "pending" },
          {
            workspaceId: connected,
            connectionStatus: "connected",
            username: "connected_coach_bot",
          },
          {
            workspaceId: needsRelink,
            connectionStatus: "needs_relink",
            username: "relink_coach_bot",
          },
        ]),
      )

      const listed = (yield* repo.list()).filter((item) => ids.includes(item.id))

      expect(listed).toEqual([
        {
          id: noBot,
          name: "A No Bot",
          botStatus: "provisioning",
          hasCustomAvatar: false,
        },
        {
          id: pending,
          name: "B Pending",
          botStatus: "provisioning",
          hasCustomAvatar: false,
        },
        {
          id: connected,
          name: "C Connected",
          botStatus: "connected",
          botUsername: "connected_coach_bot",
          hasCustomAvatar: true,
        },
        {
          id: needsRelink,
          name: "D Needs Relink",
          botStatus: "needs-relink",
          botUsername: "relink_coach_bot",
          hasCustomAvatar: false,
        },
      ])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )
})
