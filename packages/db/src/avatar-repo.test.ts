import { describe, expect, it } from "@effect/vitest"
import { WorkspaceId } from "@praximo/domain"
import { and, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { AvatarRepo } from "./avatar-repo.ts"
import { Database } from "./client.ts"
import * as schema from "./schema.ts"
import { skipWithoutDatabase, testDatabaseUrl } from "./test-database.ts"

const uniqueId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`

const NOW = new Date("2026-07-30T09:00:00.000Z")

describe.skipIf(skipWithoutDatabase)("AvatarRepo (dev Neon branch)", () => {
  const appLayer = Layer.provideMerge(AvatarRepo.layer, Database.testLayer(testDatabaseUrl))

  /**
   * One workspace with an owner, and the cleanup that removes both plus whatever
   * deletion jobs the statements under test queued.
   */
  const workspace = Effect.gen(function* () {
    const { client } = yield* Database.Service
    const workspaceId = WorkspaceId.make(uniqueId("ws_avatar"))
    const memberId = uniqueId("member")
    const keyPrefix = `avatars/coach/${workspaceId}`

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await client
          .delete(schema.objectCleanupJob)
          .where(eq(schema.objectCleanupJob.correlationId, workspaceId))
        await client.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId))
      }).pipe(Effect.asVoid),
    )

    yield* Effect.promise(() =>
      client.insert(schema.workspace).values({ id: workspaceId, name: "Ada Coaching" }),
    )
    yield* Effect.promise(() =>
      client.insert(schema.member).values({
        id: memberId,
        workspaceId,
        role: "owner",
        language: "en",
        telegramUserId: uniqueId("tg"),
      }),
    )

    const storedKey = () =>
      Effect.promise(async () => {
        const rows = await client
          .select({ avatarR2Key: schema.member.avatarR2Key })
          .from(schema.member)
          .where(eq(schema.member.id, memberId))
        return rows[0]?.avatarR2Key ?? undefined
      })

    const queuedKeys = () =>
      Effect.promise(async () => {
        const rows = await client
          .select({ objectKey: schema.objectCleanupJob.objectKey })
          .from(schema.objectCleanupJob)
          .where(eq(schema.objectCleanupJob.correlationId, workspaceId))
        return rows.map((row) => row.objectKey)
      })

    return { workspaceId, memberId, keyPrefix, storedKey, queuedKeys, client }
  })

  it.effect("writes the key on the workspace owner", () =>
    Effect.gen(function* () {
      const repo = yield* AvatarRepo.Service
      const fixture = yield* workspace
      const key = `${fixture.keyPrefix}/first.jpg`

      expect(yield* repo.coachAvatarKey(fixture.workspaceId)).toBeUndefined()

      const written = yield* repo.setCoachAvatar({
        workspaceId: fixture.workspaceId,
        r2Key: key,
        now: NOW,
      })

      expect(written).toEqual({ outcome: "written" })
      expect(yield* fixture.storedKey()).toBe(key)
      expect(yield* repo.coachAvatarKey(fixture.workspaceId)).toBe(key)
      // Nothing was replaced, so nothing is owed a deletion.
      expect(yield* fixture.queuedKeys()).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("writes nothing and queues nothing when the key has not changed", () =>
    Effect.gen(function* () {
      const repo = yield* AvatarRepo.Service
      const fixture = yield* workspace
      const key = `${fixture.keyPrefix}/same.jpg`

      yield* repo.setCoachAvatar({ workspaceId: fixture.workspaceId, r2Key: key, now: NOW })
      const again = yield* repo.setCoachAvatar({
        workspaceId: fixture.workspaceId,
        r2Key: key,
        now: NOW,
      })

      expect(again).toEqual({ outcome: "unchanged" })
      expect(yield* fixture.storedKey()).toBe(key)
      expect(yield* fixture.queuedKeys()).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("queues the key it superseded, so a replaced photo does not linger in R2", () =>
    Effect.gen(function* () {
      const repo = yield* AvatarRepo.Service
      const fixture = yield* workspace
      const before = `${fixture.keyPrefix}/before.jpg`
      const after = `${fixture.keyPrefix}/after.jpg`

      yield* repo.setCoachAvatar({ workspaceId: fixture.workspaceId, r2Key: before, now: NOW })
      const replaced = yield* repo.setCoachAvatar({
        workspaceId: fixture.workspaceId,
        r2Key: after,
        now: NOW,
      })

      expect(replaced).toEqual({ outcome: "written", superseded: before })
      expect(yield* fixture.storedKey()).toBe(after)
      expect(yield* fixture.queuedKeys()).toEqual([before])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("clears the key and queues what it dropped", () =>
    Effect.gen(function* () {
      const repo = yield* AvatarRepo.Service
      const fixture = yield* workspace
      const key = `${fixture.keyPrefix}/withdrawn.jpg`

      yield* repo.setCoachAvatar({ workspaceId: fixture.workspaceId, r2Key: key, now: NOW })
      const cleared = yield* repo.setCoachAvatar({ workspaceId: fixture.workspaceId, now: NOW })

      expect(cleared).toEqual({ outcome: "written", superseded: key })
      expect(yield* fixture.storedKey()).toBeUndefined()
      expect(yield* fixture.queuedKeys()).toEqual([key])
      // Clearing a key that is already absent is not a change and owes nothing.
      expect(yield* repo.setCoachAvatar({ workspaceId: fixture.workspaceId, now: NOW })).toEqual({
        outcome: "unchanged",
      })
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("takes the key it is about to write back out of the deletion queue", () =>
    Effect.gen(function* () {
      const repo = yield* AvatarRepo.Service
      const fixture = yield* workspace
      const first = `${fixture.keyPrefix}/a.jpg`
      const second = `${fixture.keyPrefix}/b.jpg`

      // A -> B -> A inside the cleanup window. Without the unqueue, the pending
      // job for A would delete the object the row now names.
      yield* repo.setCoachAvatar({ workspaceId: fixture.workspaceId, r2Key: first, now: NOW })
      yield* repo.setCoachAvatar({ workspaceId: fixture.workspaceId, r2Key: second, now: NOW })
      expect(yield* fixture.queuedKeys()).toEqual([first])

      yield* repo.setCoachAvatar({ workspaceId: fixture.workspaceId, r2Key: first, now: NOW })

      expect(yield* fixture.storedKey()).toBe(first)
      expect(yield* fixture.queuedKeys()).toEqual([second])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("touches the owner and nobody else", () =>
    Effect.gen(function* () {
      const repo = yield* AvatarRepo.Service
      const fixture = yield* workspace
      const assistantId = uniqueId("member")
      const assistantKey = `${fixture.keyPrefix}/assistant.jpg`
      yield* Effect.promise(() =>
        fixture.client.insert(schema.member).values({
          id: assistantId,
          workspaceId: fixture.workspaceId,
          role: "assistant",
          language: "en",
          avatarR2Key: assistantKey,
        }),
      )

      yield* repo.setCoachAvatar({
        workspaceId: fixture.workspaceId,
        r2Key: `${fixture.keyPrefix}/owner.jpg`,
        now: NOW,
      })

      const assistant = yield* Effect.promise(async () => {
        const rows = await fixture.client
          .select({ avatarR2Key: schema.member.avatarR2Key })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.workspaceId, fixture.workspaceId),
              eq(schema.member.role, "assistant"),
            ),
          )
        return rows[0]?.avatarR2Key ?? undefined
      })

      expect(assistant).toBe(assistantKey)
      expect(yield* repo.coachAvatarKey(fixture.workspaceId)).toBe(`${fixture.keyPrefix}/owner.jpg`)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("reports no change for a workspace with no owner to write to", () =>
    Effect.gen(function* () {
      const repo = yield* AvatarRepo.Service

      const written = yield* repo.setCoachAvatar({
        workspaceId: WorkspaceId.make(uniqueId("ws_absent")),
        r2Key: "avatars/coach/ws_absent/none.jpg",
        now: NOW,
      })

      expect(written).toEqual({ outcome: "no-owner" })
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("refuses to install a key the cleanup worker is deleting right now", () =>
    Effect.gen(function* () {
      const repo = yield* AvatarRepo.Service
      const fixture = yield* workspace
      const contested = `${fixture.keyPrefix}/contested.jpg`

      // Exactly the state `ObjectCleanup` leaves between claiming a job and
      // finishing with it: the row is leased, and that worker is going to delete
      // the object whatever this statement does. Removing the job row would not
      // call the deletion off — it would only lose the record of it.
      yield* Effect.promise(() =>
        fixture.client.insert(schema.objectCleanupJob).values({
          id: `cleanup_${uniqueId("leased")}`,
          objectKey: contested,
          reason: "avatar-superseded",
          correlationId: fixture.workspaceId,
          status: "leased",
          leaseUntil: new Date(NOW.getTime() + 60_000),
        }),
      )

      const deferred = yield* repo.setCoachAvatar({
        workspaceId: fixture.workspaceId,
        r2Key: contested,
        now: NOW,
      })

      expect(deferred).toEqual({ outcome: "deferred" })
      expect(yield* fixture.storedKey()).toBeUndefined()
      // The job survives, so the object it names is still deleted on schedule.
      expect(yield* fixture.queuedKeys()).toEqual([contested])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("treats a lease that has expired as ordinary queue content", () =>
    Effect.gen(function* () {
      const repo = yield* AvatarRepo.Service
      const fixture = yield* workspace
      const abandoned = `${fixture.keyPrefix}/abandoned.jpg`

      // `claimBatch` re-takes a job whose lease ran out, so nobody is holding this
      // one and the key is free to install again.
      yield* Effect.promise(() =>
        fixture.client.insert(schema.objectCleanupJob).values({
          id: `cleanup_${uniqueId("expired")}`,
          objectKey: abandoned,
          reason: "avatar-superseded",
          correlationId: fixture.workspaceId,
          status: "leased",
          leaseUntil: new Date(NOW.getTime() - 60_000),
        }),
      )

      const written = yield* repo.setCoachAvatar({
        workspaceId: fixture.workspaceId,
        r2Key: abandoned,
        now: NOW,
      })

      expect(written).toEqual({ outcome: "written" })
      expect(yield* fixture.storedKey()).toBe(abandoned)
      expect(yield* fixture.queuedKeys()).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )
})
