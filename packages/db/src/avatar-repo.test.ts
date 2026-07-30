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

      expect(written).toEqual({ outcome: "no-row" })
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

  /**
   * The client's column, which is the same statement over a different row — plus
   * the primary channel's snapshot, which is why it is worth its own suite (#231).
   */
  describe("a client's avatar", () => {
    /**
     * A workspace, a client in it, that client's primary Telegram channel with the
     * snapshot acceptance left behind, and a second workspace to prove the scope.
     */
    const roster = Effect.gen(function* () {
      const { client } = yield* Database.Service
      const workspaceId = WorkspaceId.make(uniqueId("ws_roster"))
      const otherWorkspaceId = WorkspaceId.make(uniqueId("ws_other"))
      const clientId = uniqueId("cl")
      const channelId = uniqueId("ch")
      const keyPrefix = `avatars/client/${clientId}`

      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await client
            .delete(schema.objectCleanupJob)
            .where(eq(schema.objectCleanupJob.correlationId, workspaceId))
          await client.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId))
          await client.delete(schema.workspace).where(eq(schema.workspace.id, otherWorkspaceId))
        }).pipe(Effect.asVoid),
      )

      yield* Effect.promise(async () => {
        await client.insert(schema.workspace).values([
          { id: workspaceId, name: "Ada Coaching" },
          { id: otherWorkspaceId, name: "Somebody Else" },
        ])
        await client.insert(schema.client).values({ id: clientId, workspaceId, name: "Maria K." })
        await client.insert(schema.channel).values({
          id: channelId,
          clientId,
          kind: "telegram",
          address: "810000123",
          isPrimary: true,
          snapshot: { name: "Maria", username: "maria_k" },
        })
      })

      const storedKey = () =>
        Effect.promise(async () => {
          const rows = await client
            .select({ avatarR2Key: schema.client.avatarR2Key })
            .from(schema.client)
            .where(eq(schema.client.id, clientId))
          return rows[0]?.avatarR2Key ?? undefined
        })

      const snapshot = () =>
        Effect.promise(async () => {
          const rows = await client
            .select({ snapshot: schema.channel.snapshot })
            .from(schema.channel)
            .where(eq(schema.channel.id, channelId))
          return rows[0]?.snapshot as Record<string, unknown> | undefined
        })

      const queuedKeys = () =>
        Effect.promise(async () => {
          const rows = await client
            .select({ objectKey: schema.objectCleanupJob.objectKey })
            .from(schema.objectCleanupJob)
            .where(eq(schema.objectCleanupJob.correlationId, workspaceId))
          return rows.map((row) => row.objectKey)
        })

      return {
        workspaceId,
        otherWorkspaceId,
        clientId,
        keyPrefix,
        storedKey,
        snapshot,
        queuedKeys,
        client,
      }
    })

    it.effect("writes the column and the primary channel's snapshot together", () =>
      Effect.gen(function* () {
        const repo = yield* AvatarRepo.Service
        const fixture = yield* roster
        const key = `${fixture.keyPrefix}/first.jpg`

        expect(yield* repo.clientAvatarKey(fixture.workspaceId, fixture.clientId)).toBeUndefined()

        const written = yield* repo.setClientAvatar({
          workspaceId: fixture.workspaceId,
          clientId: fixture.clientId,
          r2Key: key,
          now: NOW,
        })

        expect(written).toEqual({ outcome: "written" })
        expect(yield* fixture.storedKey()).toBe(key)
        expect(yield* repo.clientAvatarKey(fixture.workspaceId, fixture.clientId)).toBe(key)
        // One statement wrote both, which is what makes "the same key" true by
        // construction rather than by two callers agreeing. And it left the rest of
        // the snapshot — the identity that walked in — exactly as it found it.
        expect(yield* fixture.snapshot()).toEqual({
          name: "Maria",
          username: "maria_k",
          avatarR2Key: key,
        })
        expect(yield* fixture.queuedKeys()).toEqual([])
      }).pipe(Effect.scoped, Effect.provide(appLayer)),
    )

    it.effect("queues what it replaced and moves the snapshot with the column", () =>
      Effect.gen(function* () {
        const repo = yield* AvatarRepo.Service
        const fixture = yield* roster
        const before = `${fixture.keyPrefix}/before.jpg`
        const after = `${fixture.keyPrefix}/after.jpg`

        yield* repo.setClientAvatar({
          workspaceId: fixture.workspaceId,
          clientId: fixture.clientId,
          r2Key: before,
          now: NOW,
        })
        const replaced = yield* repo.setClientAvatar({
          workspaceId: fixture.workspaceId,
          clientId: fixture.clientId,
          r2Key: after,
          now: NOW,
        })

        expect(replaced).toEqual({ outcome: "written", superseded: before })
        expect(yield* fixture.storedKey()).toBe(after)
        expect((yield* fixture.snapshot())?.avatarR2Key).toBe(after)
        expect(yield* fixture.queuedKeys()).toEqual([before])
      }).pipe(Effect.scoped, Effect.provide(appLayer)),
    )

    it.effect("writes nothing, anywhere, when the key has not changed", () =>
      Effect.gen(function* () {
        const repo = yield* AvatarRepo.Service
        const fixture = yield* roster
        const key = `${fixture.keyPrefix}/same.jpg`
        const write = () =>
          repo.setClientAvatar({
            workspaceId: fixture.workspaceId,
            clientId: fixture.clientId,
            r2Key: key,
            now: NOW,
          })

        yield* write()
        const again = yield* write()

        expect(again).toEqual({ outcome: "unchanged" })
        expect(yield* fixture.storedKey()).toBe(key)
        expect((yield* fixture.snapshot())?.avatarR2Key).toBe(key)
        expect(yield* fixture.queuedKeys()).toEqual([])
      }).pipe(Effect.scoped, Effect.provide(appLayer)),
    )

    it.effect("clears both halves, and queues what it dropped", () =>
      Effect.gen(function* () {
        const repo = yield* AvatarRepo.Service
        const fixture = yield* roster
        const key = `${fixture.keyPrefix}/withdrawn.jpg`

        yield* repo.setClientAvatar({
          workspaceId: fixture.workspaceId,
          clientId: fixture.clientId,
          r2Key: key,
          now: NOW,
        })
        const cleared = yield* repo.setClientAvatar({
          workspaceId: fixture.workspaceId,
          clientId: fixture.clientId,
          now: NOW,
        })

        expect(cleared).toEqual({ outcome: "written", superseded: key })
        expect(yield* fixture.storedKey()).toBeUndefined()
        // The key goes, the identity stays: the snapshot is a record of who walked
        // in, not of what we are holding for them.
        expect(yield* fixture.snapshot()).toEqual({ name: "Maria", username: "maria_k" })
        expect(yield* fixture.queuedKeys()).toEqual([key])
      }).pipe(Effect.scoped, Effect.provide(appLayer)),
    )

    it.effect("takes the key it is about to write back out of the deletion queue", () =>
      Effect.gen(function* () {
        const repo = yield* AvatarRepo.Service
        const fixture = yield* roster
        const first = `${fixture.keyPrefix}/a.jpg`
        const second = `${fixture.keyPrefix}/b.jpg`
        const write = (r2Key: string) =>
          repo.setClientAvatar({
            workspaceId: fixture.workspaceId,
            clientId: fixture.clientId,
            r2Key,
            now: NOW,
          })

        yield* write(first)
        yield* write(second)
        expect(yield* fixture.queuedKeys()).toEqual([first])

        yield* write(first)

        expect(yield* fixture.storedKey()).toBe(first)
        expect(yield* fixture.queuedKeys()).toEqual([second])
      }).pipe(Effect.scoped, Effect.provide(appLayer)),
    )

    it.effect("refuses to install a key the cleanup worker is deleting right now", () =>
      Effect.gen(function* () {
        const repo = yield* AvatarRepo.Service
        const fixture = yield* roster
        const contested = `${fixture.keyPrefix}/contested.jpg`
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

        const deferred = yield* repo.setClientAvatar({
          workspaceId: fixture.workspaceId,
          clientId: fixture.clientId,
          r2Key: contested,
          now: NOW,
        })

        expect(deferred).toEqual({ outcome: "deferred" })
        expect(yield* fixture.storedKey()).toBeUndefined()
        // Neither half moved: a snapshot naming an object the sweeper is deleting
        // would be the same broken reference by another name.
        expect((yield* fixture.snapshot())?.avatarR2Key).toBeUndefined()
        expect(yield* fixture.queuedKeys()).toEqual([contested])
      }).pipe(Effect.scoped, Effect.provide(appLayer)),
    )

    it.effect("cannot be written, or read, from another workspace", () =>
      Effect.gen(function* () {
        const repo = yield* AvatarRepo.Service
        const fixture = yield* roster
        const key = `${fixture.keyPrefix}/mine.jpg`
        yield* repo.setClientAvatar({
          workspaceId: fixture.workspaceId,
          clientId: fixture.clientId,
          r2Key: key,
          now: NOW,
        })

        // The scope *is* the authorisation: a coach reading a client id they were
        // handed cannot reach a row in somebody else's practice, whatever the
        // caller above them forgot to check.
        const stranger = yield* repo.setClientAvatar({
          workspaceId: fixture.otherWorkspaceId,
          clientId: fixture.clientId,
          r2Key: `${fixture.keyPrefix}/theirs.jpg`,
          now: NOW,
        })

        expect(stranger).toEqual({ outcome: "no-row" })
        expect(yield* fixture.storedKey()).toBe(key)
        expect(
          yield* repo.clientAvatarKey(fixture.otherWorkspaceId, fixture.clientId),
        ).toBeUndefined()
        expect(yield* repo.clientAvatarKey(fixture.workspaceId, fixture.clientId)).toBe(key)
      }).pipe(Effect.scoped, Effect.provide(appLayer)),
    )
  })

  /**
   * What the Acceptance Page serves, resolved from the only thing that page holds
   * (#231) — and in the order #225 promised the practice photo would land in.
   */
  describe("the coach's photo behind an invitation", () => {
    const invitation = Effect.gen(function* () {
      const { client } = yield* Database.Service
      const workspaceId = WorkspaceId.make(uniqueId("ws_invite"))
      const memberId = uniqueId("member")
      const clientId = uniqueId("cl")
      const token = uniqueId("tok").replaceAll("_", "").slice(0, 12).toUpperCase()

      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId)),
        ).pipe(Effect.asVoid),
      )

      yield* Effect.promise(async () => {
        await client.insert(schema.workspace).values({ id: workspaceId, name: "Ada Coaching" })
        await client.insert(schema.member).values({
          id: memberId,
          workspaceId,
          role: "owner",
          language: "en",
          telegramUserId: uniqueId("tg"),
          avatarR2Key: `avatars/coach/${workspaceId}/member.jpg`,
        })
        await client.insert(schema.client).values({ id: clientId, workspaceId, name: "Maria K." })
        await client.insert(schema.invite).values({
          id: uniqueId("iv"),
          workspaceId,
          clientId,
          token,
          status: "pending",
          delivery: { kind: "telegram", language: "en" },
          expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1_000),
        })
      })

      const setPracticePhoto = (key: string | null) =>
        Effect.promise(() =>
          client
            .update(schema.workspace)
            .set({ avatarR2Key: key })
            .where(eq(schema.workspace.id, workspaceId)),
        ).pipe(Effect.asVoid)

      return { workspaceId, memberId, token, setPracticePhoto }
    })

    it.effect("is the coach's own photo while no practice photo exists", () =>
      Effect.gen(function* () {
        const repo = yield* AvatarRepo.Service
        const fixture = yield* invitation

        expect(yield* repo.coachAvatarKeyForInvite(fixture.token)).toBe(
          `avatars/coach/${fixture.workspaceId}/member.jpg`,
        )
      }).pipe(Effect.scoped, Effect.provide(appLayer)),
    )

    it.effect("is the practice photo once one is set, which is #225's promise kept", () =>
      Effect.gen(function* () {
        const repo = yield* AvatarRepo.Service
        const fixture = yield* invitation
        const practice = `workspace-branding/${fixture.workspaceId}.png`
        yield* fixture.setPracticePhoto(practice)

        expect(yield* repo.coachAvatarKeyForInvite(fixture.token)).toBe(practice)
        // And the member column is untouched, so the refresh still compares
        // against the photo it actually imported.
        expect(yield* repo.coachAvatarKey(fixture.workspaceId)).toBe(
          `avatars/coach/${fixture.workspaceId}/member.jpg`,
        )
      }).pipe(Effect.scoped, Effect.provide(appLayer)),
    )

    it.effect("names nothing for a token that resolves to nothing", () =>
      Effect.gen(function* () {
        const repo = yield* AvatarRepo.Service

        expect(yield* repo.coachAvatarKeyForInvite("NOSUCHTOKEN1")).toBeUndefined()
      }).pipe(Effect.scoped, Effect.provide(appLayer)),
    )
  })
})
