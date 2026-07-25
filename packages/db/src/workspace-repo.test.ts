import { describe, expect, it } from "@effect/vitest"
import { CoachOnboardingInviteId, TelegramId, Workspace, WorkspaceId } from "@praximo/domain"
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

/** Distinct Telegram identities that cannot collide with a concurrent run. */
const uniqueTelegramId = (offset: number): TelegramId =>
  TelegramId.make(String(810_000_000_000 + (Date.now() % 1_000_000) * 10 + offset))

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

      const detail = yield* repo.getDetail(id)
      const renamed = yield* repo.rename({
        id,
        expectedUpdatedAt: detail.updatedAt,
        name: "Ada's updated practice",
        now: new Date("2026-07-23T21:00:00.000Z"),
      })
      expect(renamed.name).toBe("Ada's updated practice")
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
      const awaitingSetup = WorkspaceId.make(uniqueId("ws_awaiting_setup"))
      const connected = WorkspaceId.make(uniqueId("ws_connected"))
      const needsRelink = WorkspaceId.make(uniqueId("ws_needs_relink"))
      const ids = [noBot, awaitingSetup, connected, needsRelink]

      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client.delete(schema.workspace).where(inArray(schema.workspace.id, ids)),
        ).pipe(Effect.asVoid),
      )

      yield* Effect.promise(() =>
        client.insert(schema.workspace).values([
          { id: noBot, name: "A No Bot" },
          { id: awaitingSetup, name: "B Awaiting Setup" },
          { id: connected, name: "C Connected", avatarR2Key: "avatars/a-owner.png" },
          { id: needsRelink, name: "D Needs Relink" },
        ]),
      )
      yield* Effect.promise(() =>
        client.insert(schema.member).values([
          {
            id: uniqueId("mem_awaiting_setup"),
            workspaceId: awaitingSetup,
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
          { workspaceId: awaitingSetup, connectionStatus: "awaiting_setup" },
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
          botStatus: "awaiting-setup",
        },
        {
          id: awaitingSetup,
          name: "B Awaiting Setup",
          botStatus: "awaiting-setup",
        },
        {
          id: connected,
          name: "C Connected",
          botStatus: "connected",
          botUsername: "connected_coach_bot",
        },
        {
          id: needsRelink,
          name: "D Needs Relink",
          botStatus: "needs-relink",
          botUsername: "relink_coach_bot",
        },
      ])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("carries onboarding state on the list rows, newest invite winning", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceRepo.Service
      const { client } = yield* Database.Service
      const reissued = WorkspaceId.make(uniqueId("ws_reissued"))
      const activeCoach = WorkspaceId.make(uniqueId("ws_active_coach"))
      const ids = [reissued, activeCoach]
      const suffix = uniqueId("x")
        .slice(-6)
        .toUpperCase()
        .replaceAll(/[^A-Z2-9]/g, "2")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client.delete(schema.workspace).where(inArray(schema.workspace.id, ids)),
        ).pipe(Effect.asVoid),
      )

      yield* Effect.promise(() =>
        client.insert(schema.workspace).values([
          { id: reissued, name: "E Reissued" },
          { id: activeCoach, name: "F Active" },
        ]),
      )
      yield* Effect.promise(() =>
        client.insert(schema.member).values([
          { id: uniqueId("mem_reissued"), workspaceId: reissued, role: "owner", language: "en" },
          {
            id: uniqueId("mem_active"),
            workspaceId: activeCoach,
            role: "owner",
            language: "en",
            telegramUserId: "800000042",
            termsAcceptedAt: new Date("2026-07-01T10:00:00.000Z"),
            lastActivityAt: new Date("2026-07-24T10:00:00.000Z"),
          },
        ]),
      )
      yield* Effect.promise(() =>
        client.insert(schema.coachOnboardingInvite).values([
          {
            id: uniqueId("ci_old"),
            code: `AA${suffix}`,
            workspaceId: reissued,
            requestId: crypto.randomUUID(),
            requestFingerprint: "old",
            issuedByTelegramId: "100000001",
            status: "cancelled",
            issuedAt: new Date("2026-07-20T10:00:00.000Z"),
            expiresAt: new Date("2026-07-27T10:00:00.000Z"),
            acceptedByTelegramId: "800000043",
            acceptedAt: new Date("2026-07-21T10:00:00.000Z"),
            cancelledAt: new Date("2026-07-22T10:00:00.000Z"),
            cancellationReason: "reissued",
          },
          {
            id: uniqueId("ci_new"),
            code: `BB${suffix}`,
            workspaceId: reissued,
            requestId: crypto.randomUUID(),
            requestFingerprint: "new",
            issuedByTelegramId: "100000001",
            status: "pending",
            delivery: { channel: "email", language: "ru" },
            issuedAt: new Date("2026-07-22T10:00:00.000Z"),
            expiresAt: new Date("2026-07-29T10:00:00.000Z"),
          },
        ]),
      )

      const listed = (yield* repo.list()).filter((item) => ids.includes(item.id))

      expect(listed).toEqual([
        {
          id: reissued,
          name: "E Reissued",
          botStatus: "awaiting-setup",
          // The superseded invite is history; the live one is what the list reads.
          invite: {
            id: expect.stringContaining("ci_new") as string,
            code: `BB${suffix}`,
            status: "pending",
            issuedAt: new Date("2026-07-22T10:00:00.000Z"),
            expiresAt: new Date("2026-07-29T10:00:00.000Z"),
            delivery: { channel: "email", language: "ru" },
          },
        },
        {
          id: activeCoach,
          name: "F Active",
          botStatus: "awaiting-setup",
          ownerTelegramUserId: "800000042",
          termsAcceptedAt: new Date("2026-07-01T10:00:00.000Z"),
          lastActivityAt: new Date("2026-07-24T10:00:00.000Z"),
        },
      ])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("resolves one Telegram identity's coach context", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceRepo.Service
      const { client } = yield* Database.Service
      const claimed = WorkspaceId.make(uniqueId("ws_claimed"))
      const halfway = WorkspaceId.make(uniqueId("ws_bot_connected"))
      const activated = WorkspaceId.make(uniqueId("ws_activated"))
      const ids = [claimed, halfway, activated]
      const claimant = uniqueTelegramId(1)
      const halfOwner = uniqueTelegramId(2)
      const activeOwner = uniqueTelegramId(3)
      const stranger = uniqueTelegramId(4)

      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client.delete(schema.workspace).where(inArray(schema.workspace.id, ids)),
        ).pipe(Effect.asVoid),
      )
      yield* Effect.promise(() =>
        client.insert(schema.workspace).values(ids.map((id) => ({ id, name: id }))),
      )
      yield* Effect.promise(() =>
        client.insert(schema.member).values([
          {
            id: uniqueId("mem_halfway"),
            workspaceId: halfway,
            role: "owner",
            language: "en",
            telegramUserId: halfOwner,
          },
          {
            id: uniqueId("mem_activated"),
            workspaceId: activated,
            role: "owner",
            language: "en",
            telegramUserId: activeOwner,
            termsAcceptedAt: new Date("2026-07-20T10:00:00.000Z"),
          },
        ]),
      )
      yield* Effect.promise(() =>
        client.insert(schema.bot).values([
          { workspaceId: halfway, connectionStatus: "connected", username: "half_coach_bot" },
          { workspaceId: activated, connectionStatus: "connected", username: "done_coach_bot" },
        ]),
      )
      yield* Effect.promise(() =>
        client.insert(schema.coachOnboardingInvite).values({
          id: uniqueId("ci_claim"),
          workspaceId: claimed,
          requestId: uniqueId("req"),
          requestFingerprint: "coach-context",
          code: uniqueId("CODE").toUpperCase().slice(0, 8),
          issuedByTelegramId: "100000001",
          status: "accepted",
          issuedAt: new Date("2026-07-22T10:00:00.000Z"),
          expiresAt: new Date("2026-07-29T10:00:00.000Z"),
          acceptedByTelegramId: claimant,
          acceptedAt: new Date("2026-07-23T10:00:00.000Z"),
        }),
      )

      // A connected bot without terms acceptance is provisioned, not activated.
      expect(yield* repo.findCoachByTelegramId(halfOwner)).toMatchObject({
        state: "bot-connected",
        workspaceId: halfway,
        botUsername: "half_coach_bot",
      })
      // Terms acceptance is what turns a provisioned workspace into an active
      // one. Since #54 an identity can own at most one owner seat
      // (`member_owner_telegram_user_id_idx`), so this lookup is single-valued
      // by constraint and the repo's most-advanced-state tie-break is defensive.
      expect(yield* repo.findCoachByTelegramId(activeOwner)).toMatchObject({
        state: "active",
        workspaceId: activated,
        botUsername: "done_coach_bot",
      })
      // A claim with no bot yet is still a coach — the state the manager Mini
      // App's companion renders from (#106).
      expect(yield* repo.findCoachByTelegramId(claimant)).toMatchObject({
        state: "accepted",
        workspaceId: claimed,
      })
      expect(yield* repo.findCoachByTelegramId(stranger)).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("loads the complete detail projection and protects profile updates by version", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceRepo.Service
      const { client } = yield* Database.Service
      const id = WorkspaceId.make(uniqueId("ws_detail"))
      const inviteId = CoachOnboardingInviteId.make(uniqueId("ci_detail"))
      const initialVersion = new Date("2026-07-23T20:00:00.000Z")
      const memberJoinedAt = new Date("2026-07-23T19:30:00.000Z")
      const nextVersion = new Date("2026-07-23T20:01:00.000Z")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => client.delete(schema.workspace).where(eq(schema.workspace.id, id))),
      )

      yield* Effect.promise(() =>
        client.insert(schema.workspace).values({
          id,
          name: "Initial name",
          description: "Initial description",
          avatarR2Key: "workspace-branding/initial.jpg",
          createdAt: initialVersion,
          updatedAt: initialVersion,
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.member).values({
          id: uniqueId("mem_detail"),
          workspaceId: id,
          role: "owner",
          language: "uk",
          createdAt: memberJoinedAt,
          termsAcceptedAt: new Date("2026-07-23T20:00:10.000Z"),
          lastLoginAt: new Date("2026-07-23T20:00:20.000Z"),
          lastActivityAt: new Date("2026-07-23T20:00:30.000Z"),
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.bot).values({
          workspaceId: id,
          connectionStatus: "connected",
          username: "detail_coach_bot",
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.coachOnboardingInvite).values({
          id: inviteId,
          code: "DETAIL22",
          workspaceId: id,
          requestId: crypto.randomUUID(),
          requestFingerprint: "detail",
          issuedByTelegramId: "100000001",
          status: "used",
          issuedAt: new Date("2026-07-23T19:00:00.000Z"),
          expiresAt: new Date("2026-07-30T19:00:00.000Z"),
          usedAt: new Date("2026-07-23T19:05:00.000Z"),
        }),
      )

      const detail = yield* repo.getDetail(id)
      expect(detail).toMatchObject({
        id,
        name: "Initial name",
        coachLanguage: "uk",
        botStatus: "connected",
        botUsername: "detail_coach_bot",
        // "Joined" is the member row's own creation, so it stays a different
        // fact from the terms acceptance rendered beside it.
        joinedAt: memberJoinedAt,
        termsAcceptedAt: new Date("2026-07-23T20:00:10.000Z"),
        invite: { id: inviteId, status: "used" },
      })
      // Bot branding never reaches the admin's read model (#108).
      expect(detail).not.toHaveProperty("description")
      expect(detail).not.toHaveProperty("avatarR2Key")

      const renamed = yield* repo.rename({
        id,
        expectedUpdatedAt: initialVersion,
        name: "Updated name",
        now: nextVersion,
      })
      expect(renamed).toMatchObject({ name: "Updated name", updatedAt: nextVersion })

      const conflict = yield* Effect.flip(
        repo.rename({
          id,
          expectedUpdatedAt: initialVersion,
          name: "Stale overwrite",
          now: new Date("2026-07-23T20:02:00.000Z"),
        }),
      )
      expect(conflict._tag).toBe("WorkspaceRepo.UpdateConflict")
      expect((yield* repo.getDetail(id)).name).toBe("Updated name")
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )
})
