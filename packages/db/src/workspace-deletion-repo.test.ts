import { describe, expect, it } from "@effect/vitest"
import { WorkspaceDeletionRequestId, WorkspaceId } from "@praximo/domain"
import { eq } from "drizzle-orm"
import { Effect, Layer, Result } from "effect"
import { Database } from "./client.ts"
import * as schema from "./schema.ts"
import { skipWithoutDatabase, testDatabaseUrl } from "./test-database.ts"
import { WorkspaceDeletionRepo } from "./workspace-deletion-repo.ts"

const uniqueId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`

describe.skipIf(skipWithoutDatabase)("WorkspaceDeletionRepo (dev Neon branch)", () => {
  const appLayer = Layer.provideMerge(
    WorkspaceDeletionRepo.layer,
    Database.testLayer(testDatabaseUrl),
  )

  it.effect("snapshots every owned R2 key, cascades the workspace, and replays the receipt", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceDeletionRepo.Service
      const { client } = yield* Database.Service
      const workspaceId = WorkspaceId.make(uniqueId("ws_delete"))
      const requestId = WorkspaceDeletionRequestId.make(crypto.randomUUID())
      const retryRequestId = WorkspaceDeletionRequestId.make(crypto.randomUUID())
      const clientId = uniqueId("client")
      const onboardingInviteId = uniqueId("cbi")
      const provisioningId = uniqueId("cbp")
      const sessionId = uniqueId("session")
      const recordingId = uniqueId("recording")
      const trackId = uniqueId("track")
      const keyPrefix = uniqueId("delete-test")
      const expectedKeys = [
        `${keyPrefix}/workspace/custom.jpg`,
        `${keyPrefix}/member/custom.jpg`,
        `${keyPrefix}/client/custom.jpg`,
        `${keyPrefix}/telegram/snapshot.jpg`,
        `${keyPrefix}/audio/segment-1.ogg`,
        `${keyPrefix}/audio/segment-2.ogg`,
        `${keyPrefix}/transcripts/track.json`,
        `${keyPrefix}/transcripts/session.md`,
        `${keyPrefix}/artifacts/debrief.md`,
      ]

      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await client
            .delete(schema.objectCleanupJob)
            .where(eq(schema.objectCleanupJob.correlationId, requestId))
          await client
            .delete(schema.workspaceDeletionOperation)
            .where(eq(schema.workspaceDeletionOperation.requestId, requestId))
          await client.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId))
        }).pipe(Effect.asVoid),
      )

      yield* Effect.promise(() =>
        client.insert(schema.workspace).values({
          id: workspaceId,
          name: "Ada Coaching",
          avatarR2Key: expectedKeys[0],
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.member).values({
          id: uniqueId("member"),
          workspaceId,
          role: "owner",
          language: "en",
          telegramUserId: "123456789",
          avatarR2Key: expectedKeys[1],
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.bot).values({
          workspaceId,
          connectionStatus: "connected",
          token: "v1.encrypted.test-token",
          telegramBotId: uniqueId("telegram_bot"),
          username: "workspace_delete_test_bot",
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.coachOnboardingInvite).values({
          id: onboardingInviteId,
          code: uniqueId("code"),
          workspaceId,
          requestId: crypto.randomUUID(),
          requestFingerprint: uniqueId("fingerprint"),
          issuedByTelegramId: "123456789",
          status: "used",
          issuedAt: new Date("2026-07-23T11:00:00.000Z"),
          expiresAt: new Date("2026-07-30T11:00:00.000Z"),
          usedAt: new Date("2026-07-23T11:05:00.000Z"),
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.coachBotProvisioning).values({
          id: provisioningId,
          inviteId: onboardingInviteId,
          workspaceId,
          coachTelegramId: uniqueId("coach_telegram"),
          keyboardRequestId: Math.floor(Math.random() * 2_000_000_000),
          managedBotId: uniqueId("managed_bot"),
          managedBotUsername: "workspace_delete_test_bot",
          status: "completed",
          createdAt: new Date("2026-07-23T11:00:00.000Z"),
          updatedAt: new Date("2026-07-23T11:05:00.000Z"),
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.coachBotNotification).values({
          id: uniqueId("cbn"),
          workspaceId,
          kind: "bot_connected",
          dedupeKey: `bot_connected:${workspaceId}`,
          recipientTelegramId: "123456789",
          status: "delivered",
          attemptCount: 1,
          availableAt: new Date("2026-07-23T11:05:00.000Z"),
          deliveredAt: new Date("2026-07-23T11:06:00.000Z"),
          createdAt: new Date("2026-07-23T11:05:00.000Z"),
          updatedAt: new Date("2026-07-23T11:06:00.000Z"),
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.client).values({
          id: clientId,
          workspaceId,
          name: "Client",
          avatarR2Key: expectedKeys[2],
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.channel).values({
          id: uniqueId("channel"),
          clientId,
          kind: "telegram",
          snapshot: { avatarR2Key: expectedKeys[3] },
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.session).values({
          id: sessionId,
          workspaceId,
          clientId,
          scheduledAt: new Date("2026-07-23T12:00:00.000Z"),
          durationMinutes: 60,
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.recording).values({ id: recordingId, sessionId }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.track).values({
          id: trackId,
          recordingId,
          participant: "coach",
          segments: [
            { r2Key: expectedKeys[4], order: 0 },
            { r2Key: expectedKeys[5], order: 1 },
          ],
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.trackTranscript).values({
          id: uniqueId("track_transcript"),
          trackId,
          r2Key: expectedKeys[6],
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.transcript).values({
          id: uniqueId("transcript"),
          sessionId,
          r2Key: expectedKeys[7],
        }),
      )
      yield* Effect.promise(() =>
        client.insert(schema.artifact).values({
          id: uniqueId("artifact"),
          sessionId,
          kind: "debrief",
          r2Key: expectedKeys[8],
        }),
      )

      const prepared = yield* repo.prepare(
        workspaceId,
        requestId,
        new Date("2026-07-23T12:01:00.000Z"),
      )
      expect(prepared.workspaceName).toBe("Ada Coaching")
      expect(prepared.coachTelegramId).toBe("123456789")

      const { lease } = yield* repo.claim(requestId, new Date("2026-07-23T12:01:30.000Z"))
      yield* repo.markPipeline(lease, "nothing-active", new Date("2026-07-23T12:02:00.000Z"))
      yield* repo.markFarewell(lease, "sent", new Date("2026-07-23T12:03:00.000Z"))
      yield* repo.markBotReleased(lease, "released", new Date("2026-07-23T12:04:00.000Z"))
      const completed = yield* repo.finalize(lease, new Date("2026-07-23T12:05:00.000Z"))

      expect(completed.state).toBe("completed")
      expect(
        yield* Effect.promise(() =>
          client.select().from(schema.workspace).where(eq(schema.workspace.id, workspaceId)),
        ),
      ).toEqual([])
      expect(
        yield* Effect.promise(() =>
          client.select().from(schema.bot).where(eq(schema.bot.workspaceId, workspaceId)),
        ),
      ).toEqual([])
      expect(
        yield* Effect.promise(() =>
          client
            .select()
            .from(schema.coachBotProvisioning)
            .where(eq(schema.coachBotProvisioning.workspaceId, workspaceId)),
        ),
      ).toEqual([])
      expect(
        yield* Effect.promise(() =>
          client
            .select()
            .from(schema.coachBotNotification)
            .where(eq(schema.coachBotNotification.workspaceId, workspaceId)),
        ),
      ).toEqual([])
      const jobs = yield* Effect.promise(() =>
        client
          .select({ objectKey: schema.objectCleanupJob.objectKey })
          .from(schema.objectCleanupJob)
          .where(eq(schema.objectCleanupJob.correlationId, requestId)),
      )
      expect(new Set(jobs.map((job) => job.objectKey))).toEqual(new Set(expectedKeys))

      expect((yield* repo.prepare(workspaceId, requestId, new Date())).state).toBe("completed")
      const missing = yield* Effect.flip(repo.prepare(workspaceId, retryRequestId, new Date()))
      expect(missing._tag).toBe("Domain.WorkspaceNotFound")
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("reads a workspace's own receipt before and after the cascade", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceDeletionRepo.Service
      const { client } = yield* Database.Service
      const workspaceId = WorkspaceId.make(uniqueId("ws_progress"))
      const requestId = WorkspaceDeletionRequestId.make(crypto.randomUUID())
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await client
            .delete(schema.workspaceDeletionOperation)
            .where(eq(schema.workspaceDeletionOperation.workspaceId, workspaceId))
          await client.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId))
        }).pipe(Effect.asVoid),
      )

      expect(yield* repo.findByWorkspace(workspaceId)).toBeUndefined()
      yield* Effect.promise(() =>
        client.insert(schema.workspace).values({ id: workspaceId, name: "Ada Coaching" }),
      )
      yield* repo.prepare(workspaceId, requestId, new Date("2026-07-24T10:00:00.000Z"))

      const prepared = yield* repo.findByWorkspace(workspaceId)
      expect(prepared?.requestId).toBe(requestId)
      expect(prepared?.state).toBe("prepared")
      expect(prepared?.workspaceName).toBe("Ada Coaching")
      expect(yield* repo.listPrepared()).toContain(workspaceId)

      const { lease } = yield* repo.claim(requestId, new Date("2026-07-24T10:00:30.000Z"))
      yield* repo.markPipeline(lease, "nothing-active", new Date())
      yield* repo.markFarewell(lease, "not-applicable", new Date())
      yield* repo.markBotReleased(lease, "not-connected", new Date())
      yield* repo.finalize(lease, new Date())

      // The workspace is gone; the receipt is the only remaining account of it,
      // and the progress surface keeps reading it to its final stage (#110).
      const completed = yield* repo.findByWorkspace(workspaceId)
      expect(completed?.state).toBe("completed")
      expect(completed?.workspaceName).toBeUndefined()
      expect(yield* repo.listPrepared()).not.toContain(workspaceId)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("reads the receipt of a workspace that was never labelled", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceDeletionRepo.Service
      const { client } = yield* Database.Service
      const workspaceId = WorkspaceId.make(uniqueId("ws_unnamed"))
      const requestId = WorkspaceDeletionRequestId.make(crypto.randomUUID())
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await client
            .delete(schema.workspaceDeletionOperation)
            .where(eq(schema.workspaceDeletionOperation.workspaceId, workspaceId))
          await client.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId))
        }).pipe(Effect.asVoid),
      )

      // An invite-first workspace the admin never labelled. Its empty name is a
      // real value, so the receipt must read it rather than refuse the row —
      // refusing it stranded the coach's card mid-deletion with no way back in.
      yield* Effect.promise(() =>
        client.insert(schema.workspace).values({ id: workspaceId, name: "" }),
      )
      yield* repo.prepare(workspaceId, requestId, new Date("2026-07-24T10:00:00.000Z"))

      const prepared = yield* repo.findByWorkspace(workspaceId)
      expect(prepared?.state).toBe("prepared")
      expect(prepared?.workspaceName).toBe("")
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("adopts an interrupted operation for a fresh requestId and resumes to completion", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceDeletionRepo.Service
      const { client } = yield* Database.Service
      const workspaceId = WorkspaceId.make(uniqueId("ws_adopt"))
      const staleRequestId = WorkspaceDeletionRequestId.make(crypto.randomUUID())
      const freshRequestId = WorkspaceDeletionRequestId.make(crypto.randomUUID())
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await client
            .delete(schema.objectCleanupJob)
            .where(eq(schema.objectCleanupJob.correlationId, staleRequestId))
          await client
            .delete(schema.workspaceDeletionOperation)
            .where(eq(schema.workspaceDeletionOperation.workspaceId, workspaceId))
          await client.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId))
        }).pipe(Effect.asVoid),
      )
      yield* Effect.promise(() =>
        client.insert(schema.workspace).values({ id: workspaceId, name: "Ada Coaching" }),
      )

      const prepared = yield* repo.prepare(
        workspaceId,
        staleRequestId,
        new Date("2026-07-24T10:00:00.000Z"),
      )
      expect(prepared.requestId).toBe(staleRequestId)

      // Interruption: the dialog remounts and mints a fresh requestId. prepare
      // must adopt the existing prepared operation rather than report a conflict.
      const adopted = yield* repo.prepare(
        workspaceId,
        freshRequestId,
        new Date("2026-07-24T10:05:00.000Z"),
      )
      expect(adopted.requestId).toBe(staleRequestId)
      expect(adopted.state).toBe("prepared")

      // The resumed session drives the adopted operation under its own id.
      const { lease } = yield* repo.claim(staleRequestId, new Date("2026-07-24T10:05:30.000Z"))
      yield* repo.markPipeline(lease, "nothing-active", new Date("2026-07-24T10:06:00.000Z"))
      yield* repo.markFarewell(lease, "not-applicable", new Date("2026-07-24T10:06:00.000Z"))
      yield* repo.markBotReleased(lease, "not-connected", new Date("2026-07-24T10:06:00.000Z"))
      const completed = yield* repo.finalize(lease, new Date("2026-07-24T10:07:00.000Z"))
      expect(completed.state).toBe("completed")
      expect(
        yield* Effect.promise(() =>
          client.select().from(schema.workspace).where(eq(schema.workspace.id, workspaceId)),
        ),
      ).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("leases the operation to one driver and fences out every other writer", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceDeletionRepo.Service
      const { client } = yield* Database.Service
      const workspaceId = WorkspaceId.make(uniqueId("ws_lease"))
      const requestId = WorkspaceDeletionRequestId.make(crypto.randomUUID())
      const claimedAt = new Date("2026-07-24T20:00:00.000Z")
      const beforeExpiry = new Date(
        claimedAt.getTime() + WorkspaceDeletionRepo.LEASE_DURATION_MS - 1_000,
      )
      const afterExpiry = new Date(
        claimedAt.getTime() + WorkspaceDeletionRepo.LEASE_DURATION_MS + 1_000,
      )
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await client
            .delete(schema.workspaceDeletionOperation)
            .where(eq(schema.workspaceDeletionOperation.workspaceId, workspaceId))
          await client.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId))
        }).pipe(Effect.asVoid),
      )
      yield* Effect.promise(() =>
        client.insert(schema.workspace).values({ id: workspaceId, name: "Ada Coaching" }),
      )
      yield* repo.prepare(workspaceId, requestId, claimedAt)

      // Two attempts contend for one operation; the conditional UPDATE picks one.
      const contested = yield* Effect.all(
        [
          repo.claim(requestId, claimedAt).pipe(Effect.result),
          repo.claim(requestId, claimedAt).pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      )
      const won = contested.filter(Result.isSuccess)
      const lost = contested.filter(Result.isFailure)
      expect(won).toHaveLength(1)
      expect(lost.map((outcome) => outcome.failure._tag)).toEqual([
        "WorkspaceDeletionRepo.LeaseHeld",
      ])
      const lease = won[0]?.success.lease
      if (lease === undefined) return yield* Effect.die("the winning claim carried no lease")

      // A driver holding no live lease cannot advance a stage, even though the
      // operation is still prepared and the status is still pending.
      const fenced = yield* Effect.flip(
        repo.markPipeline({ requestId, driverId: crypto.randomUUID() }, "cancelled", beforeExpiry),
      )
      expect(fenced._tag).toBe("WorkspaceDeletionRepo.InvalidTransition")

      yield* repo.markPipeline(lease, "cancelled", beforeExpiry)

      // Once the lease lapses another attempt takes over, and the abandoned
      // driver's writes stop landing.
      const takeover = yield* repo.claim(requestId, afterExpiry)
      expect(takeover.operation.pipelineStatus).toBe("cancelled")
      const stale = yield* Effect.flip(repo.markFarewell(lease, "sent", afterExpiry))
      expect(stale._tag).toBe("WorkspaceDeletionRepo.InvalidTransition")

      // A released lease frees the operation immediately, without waiting out
      // the TTL — the retry path after a failed stage.
      yield* repo.release(takeover.lease)
      expect((yield* repo.claim(requestId, afterExpiry)).operation.pipelineStatus).toBe("cancelled")
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("reconciles a prepared operation whose workspace is already gone", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceDeletionRepo.Service
      const { client } = yield* Database.Service
      const workspaceId = WorkspaceId.make(uniqueId("ws_orphan"))
      const requestId = WorkspaceDeletionRequestId.make(crypto.randomUUID())
      const selectRow = () =>
        client
          .select({ requestId: schema.workspaceDeletionOperation.requestId })
          .from(schema.workspaceDeletionOperation)
          .where(eq(schema.workspaceDeletionOperation.requestId, requestId))
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await client
            .delete(schema.workspaceDeletionOperation)
            .where(eq(schema.workspaceDeletionOperation.requestId, requestId))
          await client.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId))
        }).pipe(Effect.asVoid),
      )
      yield* Effect.promise(() =>
        client.insert(schema.workspace).values({ id: workspaceId, name: "Ada Coaching" }),
      )
      yield* repo.prepare(workspaceId, requestId, new Date())

      // Safety: a prepared operation whose workspace still exists is left alone.
      yield* repo.reconcileOrphans()
      expect((yield* Effect.promise(selectRow)).length).toBe(1)

      // Workspace removed out of band: the prepared row can never finalize.
      yield* Effect.promise(() =>
        client.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId)),
      )
      expect(yield* repo.reconcileOrphans()).toBeGreaterThanOrEqual(1)
      expect(yield* Effect.promise(selectRow)).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )
})
