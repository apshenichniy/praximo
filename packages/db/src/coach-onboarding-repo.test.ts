import { describe, expect, it } from "@effect/vitest"
import { CoachLanguage } from "@praximo/domain"
import { eq } from "drizzle-orm"
import { Effect, Layer, Result } from "effect"
import { CoachOnboardingRepo, InviteTtlMilliseconds } from "./coach-onboarding-repo.ts"
import { Database } from "./client.ts"
import * as schema from "./schema.ts"

const DATABASE_URL = process.env.DATABASE_URL
const requestId = () => crypto.randomUUID()

describe.skipIf(!DATABASE_URL)("CoachOnboardingRepo (dev Neon branch)", () => {
  const appLayer = Layer.provideMerge(
    CoachOnboardingRepo.layer,
    Database.testLayer(DATABASE_URL ?? ""),
  )

  it.effect("atomically creates the aggregate and makes identical retries idempotent", () =>
    Effect.gen(function* () {
      const repo = yield* CoachOnboardingRepo.Service
      const { client } = yield* Database.Service
      const input = {
        requestId: requestId(),
        requestFingerprint: "same-payload",
        name: "Ada Coaching",
        coachLanguage: CoachLanguage.make("uk"),
        description: "A coaching practice",
        now: new Date("2026-07-23T18:00:00.000Z"),
      }
      const createdOutcome = yield* repo.createOrGet(input)
      const created = createdOutcome.aggregate
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client.delete(schema.workspace).where(eq(schema.workspace.id, created.workspace.id)),
        ).pipe(Effect.asVoid),
      )

      const replay = yield* repo.createOrGet(input)
      expect(replay).toEqual({ aggregate: created, created: false })
      expect(createdOutcome.created).toBe(true)
      expect(created.owner).toEqual({ language: "uk" })
      expect(created.invite.status).toBe("pending")
      expect(created.invite.expiresAt.getTime() - created.invite.issuedAt.getTime()).toBe(
        InviteTtlMilliseconds,
      )
      expect(
        (yield* repo.verifyPending(created.invite.id, new Date("2026-07-23T18:30:00.000Z"))).invite
          .status,
      ).toBe("pending")

      const conflict = yield* Effect.flip(
        repo.createOrGet({ ...input, requestFingerprint: "different-payload" }),
      )
      expect(conflict._tag).toBe("CoachOnboardingRepo.IdempotencyConflict")

      const used = yield* repo.markUsed(created.invite.id, new Date("2026-07-23T19:00:00.000Z"))
      expect(used.status).toBe("used")
      const duplicate = yield* Effect.flip(
        repo.markUsed(created.invite.id, new Date("2026-07-23T19:00:01.000Z")),
      )
      expect(duplicate).toMatchObject({
        _tag: "CoachOnboardingRepo.InviteUnavailable",
        reason: "used",
      })
      expect(
        yield* Effect.flip(
          repo.verifyPending(created.invite.id, new Date("2026-07-23T19:00:02.000Z")),
        ),
      ).toMatchObject({ reason: "used" })

      const concurrentOutcome = yield* repo.createOrGet({
        ...input,
        requestId: requestId(),
        requestFingerprint: "concurrent-mark-used",
      })
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client
            .delete(schema.workspace)
            .where(eq(schema.workspace.id, concurrentOutcome.aggregate.workspace.id)),
        ).pipe(Effect.asVoid),
      )
      const attempts = yield* Effect.all(
        [
          repo
            .markUsed(concurrentOutcome.aggregate.invite.id, new Date("2026-07-23T20:00:00.000Z"))
            .pipe(Effect.result),
          repo
            .markUsed(concurrentOutcome.aggregate.invite.id, new Date("2026-07-23T20:00:00.000Z"))
            .pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      )
      expect(attempts.filter(Result.isSuccess)).toHaveLength(1)
      expect(attempts.filter(Result.isFailure)).toHaveLength(1)

      const expiredOutcome = yield* repo.createOrGet({
        ...input,
        requestId: requestId(),
        requestFingerprint: "expired-invite",
      })
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client
            .delete(schema.workspace)
            .where(eq(schema.workspace.id, expiredOutcome.aggregate.workspace.id)),
        ).pipe(Effect.asVoid),
      )
      const expired = yield* Effect.flip(
        repo.markUsed(
          expiredOutcome.aggregate.invite.id,
          new Date(input.now.getTime() + InviteTtlMilliseconds + 1),
        ),
      )
      expect(expired).toMatchObject({
        _tag: "CoachOnboardingRepo.InviteUnavailable",
        reason: "expired",
      })
      expect(
        yield* Effect.flip(
          repo.verifyPending(
            expiredOutcome.aggregate.invite.id,
            new Date(input.now.getTime() + InviteTtlMilliseconds + 1),
          ),
        ),
      ).toMatchObject({ reason: "expired" })
      expect((yield* repo.findInvite(expiredOutcome.aggregate.invite.id)).invite.status).toBe(
        "expired",
      )
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("serializes concurrent identical and conflicting create requests", () =>
    Effect.gen(function* () {
      const repo = yield* CoachOnboardingRepo.Service
      const { client } = yield* Database.Service
      const now = new Date("2026-07-23T18:00:00.000Z")
      const base = {
        requestId: requestId(),
        requestFingerprint: "concurrent-identical",
        name: "Concurrent Coaching",
        coachLanguage: CoachLanguage.make("en"),
        now,
      }
      const identical = yield* Effect.all([repo.createOrGet(base), repo.createOrGet(base)], {
        concurrency: "unbounded",
      })
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client
            .delete(schema.workspace)
            .where(eq(schema.workspace.id, identical[0].aggregate.workspace.id)),
        ).pipe(Effect.asVoid),
      )
      expect(identical.filter((outcome) => outcome.created)).toHaveLength(1)
      expect(identical.filter((outcome) => !outcome.created)).toHaveLength(1)
      expect(identical[0].aggregate).toEqual(identical[1].aggregate)

      const conflictingRequestId = requestId()
      const conflicting = yield* Effect.all(
        [
          repo
            .createOrGet({
              ...base,
              requestId: conflictingRequestId,
              requestFingerprint: "concurrent-a",
            })
            .pipe(Effect.result),
          repo
            .createOrGet({
              ...base,
              requestId: conflictingRequestId,
              requestFingerprint: "concurrent-b",
            })
            .pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      )
      const success = conflicting.find(Result.isSuccess)
      expect(success).toBeDefined()
      if (success === undefined || Result.isFailure(success)) return
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client
            .delete(schema.workspace)
            .where(eq(schema.workspace.id, success.success.aggregate.workspace.id)),
        ).pipe(Effect.asVoid),
      )
      expect(conflicting.filter(Result.isSuccess)).toHaveLength(1)
      expect(conflicting.filter(Result.isFailure)).toHaveLength(1)
      const failure = conflicting.find(Result.isFailure)
      expect(failure).toBeDefined()
      if (failure !== undefined && Result.isFailure(failure)) {
        expect(failure.failure._tag).toBe("CoachOnboardingRepo.IdempotencyConflict")
      }
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("rotates one Awaiting Setup invite idempotently and rejects stale rotation", () =>
    Effect.gen(function* () {
      const repo = yield* CoachOnboardingRepo.Service
      const { client } = yield* Database.Service
      const created = yield* repo.createOrGet({
        requestId: requestId(),
        requestFingerprint: "reissue-source",
        name: "Reissue Coaching",
        coachLanguage: CoachLanguage.make("en"),
        now: new Date("2026-07-23T18:00:00.000Z"),
      })
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client
            .delete(schema.workspace)
            .where(eq(schema.workspace.id, created.aggregate.workspace.id)),
        ).pipe(Effect.asVoid),
      )

      const reissueRequestId = requestId()
      const reissued = yield* repo.reissue({
        workspaceId: created.aggregate.workspace.id,
        expectedInviteId: created.aggregate.invite.id,
        requestId: reissueRequestId,
        now: new Date("2026-07-24T18:00:00.000Z"),
      })
      expect(reissued.invite.id).not.toBe(created.aggregate.invite.id)
      expect(reissued.invite.status).toBe("pending")
      expect(reissued.invite.expiresAt.getTime() - reissued.invite.issuedAt.getTime()).toBe(
        InviteTtlMilliseconds,
      )
      expect((yield* repo.findInvite(created.aggregate.invite.id)).invite.status).toBe("expired")

      const replay = yield* repo.reissue({
        workspaceId: created.aggregate.workspace.id,
        expectedInviteId: created.aggregate.invite.id,
        requestId: reissueRequestId,
        now: new Date("2026-07-24T18:00:01.000Z"),
      })
      expect(replay.invite.id).toBe(reissued.invite.id)

      const stale = yield* Effect.flip(
        repo.reissue({
          workspaceId: created.aggregate.workspace.id,
          expectedInviteId: created.aggregate.invite.id,
          requestId: requestId(),
          now: new Date("2026-07-24T18:00:02.000Z"),
        }),
      )
      expect(stale._tag).toBe("CoachOnboardingRepo.ReissueUnavailable")
      expect(
        (yield* repo.verifyPending(reissued.invite.id, new Date("2026-07-24T18:00:03.000Z"))).invite
          .id,
      ).toBe(reissued.invite.id)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("serializes concurrent identical and competing re-issue requests", () =>
    Effect.gen(function* () {
      const repo = yield* CoachOnboardingRepo.Service
      const { client } = yield* Database.Service
      const makeWorkspace = (fingerprint: string) =>
        repo.createOrGet({
          requestId: requestId(),
          requestFingerprint: fingerprint,
          name: "Concurrent reissue",
          coachLanguage: CoachLanguage.make("en"),
          now: new Date("2026-07-23T18:00:00.000Z"),
        })

      const identicalSource = yield* makeWorkspace("concurrent-reissue-identical")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client
            .delete(schema.workspace)
            .where(eq(schema.workspace.id, identicalSource.aggregate.workspace.id)),
        ).pipe(Effect.asVoid),
      )
      const identicalRequestId = requestId()
      const identical = yield* Effect.all(
        [
          repo.reissue({
            workspaceId: identicalSource.aggregate.workspace.id,
            expectedInviteId: identicalSource.aggregate.invite.id,
            requestId: identicalRequestId,
            now: new Date("2026-07-24T18:00:00.000Z"),
          }),
          repo.reissue({
            workspaceId: identicalSource.aggregate.workspace.id,
            expectedInviteId: identicalSource.aggregate.invite.id,
            requestId: identicalRequestId,
            now: new Date("2026-07-24T18:00:00.000Z"),
          }),
        ],
        { concurrency: "unbounded" },
      )
      expect(identical[0].invite.id).toBe(identical[1].invite.id)

      const competingSource = yield* makeWorkspace("concurrent-reissue-competing")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client
            .delete(schema.workspace)
            .where(eq(schema.workspace.id, competingSource.aggregate.workspace.id)),
        ).pipe(Effect.asVoid),
      )
      const competing = yield* Effect.all(
        [
          repo
            .reissue({
              workspaceId: competingSource.aggregate.workspace.id,
              expectedInviteId: competingSource.aggregate.invite.id,
              requestId: requestId(),
              now: new Date("2026-07-24T18:00:00.000Z"),
            })
            .pipe(Effect.result),
          repo
            .reissue({
              workspaceId: competingSource.aggregate.workspace.id,
              expectedInviteId: competingSource.aggregate.invite.id,
              requestId: requestId(),
              now: new Date("2026-07-24T18:00:00.000Z"),
            })
            .pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      )
      expect(competing.filter(Result.isSuccess)).toHaveLength(1)
      expect(competing.filter(Result.isFailure)).toHaveLength(1)
      const failure = competing.find(Result.isFailure)
      expect(failure).toBeDefined()
      if (failure !== undefined && Result.isFailure(failure)) {
        expect(failure.failure._tag).toBe("CoachOnboardingRepo.ReissueUnavailable")
      }
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )
})
