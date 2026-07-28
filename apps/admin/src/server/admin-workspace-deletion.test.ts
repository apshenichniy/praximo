import { describe, expect, it } from "@effect/vitest"
import { CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import { AdminRepo, CoachOnboardingRepo, WorkspaceDeletionRepo, WorkspaceRepo } from "@praximo/db"
import {
  Admin,
  AdminId,
  CoachLanguage,
  TelegramId,
  WorkspaceDeletionRequestId,
  WorkspaceId,
  WorkspaceRunCancellationResult,
} from "@praximo/domain"
import { CoachBotRelease, ManagerBotSender } from "@praximo/telegram"
import { Effect, Layer, Ref, Result } from "effect"
import { AdminSurface } from "./admin-surface.ts"
import { WorkspaceRunCancellation } from "./workspace-run-cancellation.ts"

const workspaceId = WorkspaceId.make("ws_delete_test")
const requestId = WorkspaceDeletionRequestId.make("cb6bd559-6091-4d69-aeff-2af000354c7f")
const adminTelegramId = TelegramId.make("123456789")

const unusedWorkspaceLayer = Layer.succeed(
  WorkspaceRepo.Service,
  WorkspaceRepo.Service.of({
    create: Effect.fn("WorkspaceRepo.DeleteTest.create")(() => Effect.die("unused")),
    findById: Effect.fn("WorkspaceRepo.DeleteTest.findById")(() => Effect.die("unused")),
    list: Effect.fn("WorkspaceRepo.DeleteTest.list")(() => Effect.die("unused")),
    getDetail: Effect.fn("WorkspaceRepo.DeleteTest.getDetail")(() => Effect.die("unused")),
    findCoachByTelegramId: Effect.fn("WorkspaceRepo.DeleteTest.findCoachByTelegramId")(() =>
      Effect.die("unused"),
    ),
    rename: Effect.fn("WorkspaceRepo.DeleteTest.rename")(() => Effect.die("unused")),
  }),
)

const unusedOnboardingLayer = Layer.succeed(
  CoachOnboardingRepo.Service,
  CoachOnboardingRepo.Service.of({
    lookupCreate: Effect.fn("CoachOnboardingRepo.DeleteTest.lookupCreate")(() =>
      Effect.die("unused"),
    ),
    createOrGet: Effect.fn("CoachOnboardingRepo.DeleteTest.createOrGet")(() =>
      Effect.die("unused"),
    ),
    resolveCode: Effect.fn("CoachOnboardingRepo.Test.resolveCode")(() =>
      Effect.die("resolveCode is bot-only and unused in these tests"),
    ),
    findInvite: Effect.fn("CoachOnboardingRepo.DeleteTest.findInvite")(() => Effect.die("unused")),
    verifyPending: Effect.fn("CoachOnboardingRepo.DeleteTest.verifyPending")(() =>
      Effect.die("unused"),
    ),
    markUsed: Effect.fn("CoachOnboardingRepo.DeleteTest.markUsed")(() => Effect.die("unused")),
    recordDelivery: Effect.fn("CoachOnboardingRepo.DeleteTest.recordDelivery")(() =>
      Effect.die("unused"),
    ),
    reissue: Effect.fn("CoachOnboardingRepo.DeleteTest.reissue")(() => Effect.die("unused")),
  }),
)

const authLayer = Layer.mergeAll(
  Layer.succeed(
    ManagerInitData.Service,
    ManagerInitData.Service.of({
      verify: Effect.fn("ManagerInitData.DeleteTest.verify")(() => Effect.succeed(adminTelegramId)),
    }),
  ),
  Layer.succeed(
    AdminRepo.Service,
    AdminRepo.Service.of({
      upsertByTelegramId: Effect.fn("AdminRepo.DeleteTest.upsert")(() => Effect.die("unused")),
      findByTelegramId: Effect.fn("AdminRepo.DeleteTest.find")(() =>
        Effect.succeed(
          Admin.make({
            id: AdminId.make("adm_delete_test"),
            telegramId: adminTelegramId,
          }),
        ),
      ),
    }),
  ),
)

interface DeletionDouble {
  readonly layer: Layer.Layer<WorkspaceDeletionRepo.Service>
  /** The receipt as it stands now. */
  readonly operation: Effect.Effect<WorkspaceDeletionRepo.Operation>
  /** The requestId each stage write was driven under, in call order. */
  readonly driverRequestIds: Effect.Effect<ReadonlyArray<string>>
}

/**
 * A Ref-backed stand-in for the receipt row. Two properties make it a real
 * test of the single-driver rule rather than a test of itself:
 *
 * - the claim and every stage write go through one `Ref.modify`, which is
 *   all-or-nothing exactly like the conditional UPDATE they stand for;
 * - every call opens with `Effect.yieldNow`, standing in for the database round
 *   trip. Without it a fiber would run the whole pipeline before the second one
 *   started and no interleaving would ever be exercised.
 *
 * Lease expiry is not modelled: these tests are about two live attempts, and
 * the TTL only decides who may take over from an attempt that is already dead.
 */
const deletionRepoDouble = (initial: WorkspaceDeletionRepo.Operation) =>
  Effect.gen(function* () {
    interface Row {
      readonly operation: WorkspaceDeletionRepo.Operation
      readonly driverId: string | undefined
    }
    const row = yield* Ref.make<Row>({ operation: initial, driverId: undefined })
    const claims = yield* Ref.make(0)
    const driverRequestIds = yield* Ref.make<ReadonlyArray<string>>([])
    const roundTrip = Effect.yieldNow

    const write = Effect.fn("WorkspaceDeletionRepo.Double.write")(function* (
      lease: WorkspaceDeletionRepo.Lease,
      values: Partial<WorkspaceDeletionRepo.Operation>,
      now: Date,
      operation: string,
    ) {
      yield* roundTrip
      yield* Ref.update(driverRequestIds, (ids) => [...ids, lease.requestId])
      const written = yield* Ref.modify(row, (current) =>
        current.driverId === lease.driverId
          ? [
              { ...current.operation, ...values, updatedAt: now },
              { ...current, operation: { ...current.operation, ...values, updatedAt: now } },
            ]
          : [undefined, current],
      )
      // A driver that lost the lease writes nothing, exactly as the fenced UPDATE
      // matches no row.
      if (written === undefined)
        return yield* new WorkspaceDeletionRepo.InvalidTransition({ operation })
      return written
    })

    const layer = Layer.succeed(
      WorkspaceDeletionRepo.Service,
      WorkspaceDeletionRepo.Service.of({
        // Adoption: any requestId resolves to the one prepared operation, so a
        // resumed attempt contends for the same lease as the original.
        prepare: Effect.fn("WorkspaceDeletionRepo.Double.prepare")(function* () {
          yield* roundTrip
          return (yield* Ref.get(row)).operation
        }),
        claim: Effect.fn("WorkspaceDeletionRepo.Double.claim")(function* (_requestId, now) {
          yield* roundTrip
          const driverId = `driver-${yield* Ref.updateAndGet(claims, (count) => count + 1)}`
          const leaseUntil = new Date(now.getTime() + WorkspaceDeletionRepo.LEASE_DURATION_MS)
          const before = yield* Ref.modify(row, (current) =>
            current.operation.state === "prepared" && current.driverId === undefined
              ? [current, { ...current, driverId, operation: { ...current.operation, leaseUntil } }]
              : [current, current],
          )
          if (before.operation.state === "prepared" && before.driverId !== undefined) {
            return yield* new WorkspaceDeletionRepo.LeaseHeld()
          }
          return {
            lease: { requestId: before.operation.requestId, driverId },
            operation: before.operation,
          }
        }),
        release: Effect.fn("WorkspaceDeletionRepo.Double.release")(function* (lease) {
          yield* roundTrip
          yield* Ref.update(row, (current) => {
            if (current.driverId !== lease.driverId) return current
            const { leaseUntil: _released, ...operation } = current.operation
            return { operation, driverId: undefined }
          })
        }),
        markPipeline: Effect.fn("WorkspaceDeletionRepo.Double.markPipeline")((lease, status, now) =>
          write(lease, { pipelineStatus: status }, now, "markPipeline"),
        ),
        markFarewell: Effect.fn("WorkspaceDeletionRepo.Double.markFarewell")((lease, status, now) =>
          write(lease, { farewellStatus: status }, now, "markFarewell"),
        ),
        markBotReleased: Effect.fn("WorkspaceDeletionRepo.Double.markBotReleased")(
          (lease, status, now) =>
            write(lease, { botReleaseStatus: status }, now, "markBotReleased"),
        ),
        finalize: Effect.fn("WorkspaceDeletionRepo.Double.finalize")((lease, now) =>
          write(lease, { state: "completed", completedAt: now }, now, "finalize"),
        ),
        findByWorkspace: Effect.fn("WorkspaceDeletionRepo.Double.findByWorkspace")(() =>
          Ref.get(row).pipe(Effect.map((current) => current.operation)),
        ),
        listPrepared: Effect.fn("WorkspaceDeletionRepo.Double.listPrepared")(() =>
          Effect.succeed([workspaceId]),
        ),
        purgeExpired: Effect.fn("WorkspaceDeletionRepo.Double.purgeExpired")(() =>
          Effect.succeed(0),
        ),
        reconcileOrphans: Effect.fn("WorkspaceDeletionRepo.Double.reconcileOrphans")(() =>
          Effect.succeed(0),
        ),
      }),
    )

    return {
      layer,
      operation: Ref.get(row).pipe(Effect.map((current) => current.operation)),
      driverRequestIds: Ref.get(driverRequestIds),
    } satisfies DeletionDouble
  })

const unusedCancellationLayer = Layer.succeed(
  WorkspaceRunCancellation.Service,
  WorkspaceRunCancellation.Service.of({
    cancel: Effect.fn("WorkspaceRunCancellation.ReadTest.cancel")(() => Effect.die("unused")),
    kickObjectCleanup: Effect.fn("WorkspaceRunCancellation.ReadTest.kick")(() =>
      Effect.die("unused"),
    ),
  }),
)

const pendingOperation: WorkspaceDeletionRepo.Operation = {
  requestId,
  workspaceId,
  state: "prepared",
  pipelineStatus: "pending",
  farewellStatus: "pending",
  botReleaseStatus: "pending",
  createdAt: new Date("2026-07-23T12:00:00.000Z"),
  updatedAt: new Date("2026-07-23T12:00:00.000Z"),
  workspaceName: "Ada Coaching",
  coachTelegramId: adminTelegramId,
  coachLanguage: CoachLanguage.make("en"),
}

describe("AdminSurface workspace deletion", () => {
  it.effect("runs the required saga once and returns an idempotent completed result", () =>
    Effect.gen(function* () {
      const deletions = yield* deletionRepoDouble(pendingOperation)
      const cancellationCalls = yield* Ref.make(0)
      const cleanupKicks = yield* Ref.make(0)
      const cancellationLayer = Layer.succeed(
        WorkspaceRunCancellation.Service,
        WorkspaceRunCancellation.Service.of({
          cancel: Effect.fn("WorkspaceRunCancellation.DeleteTest.cancel")(function* () {
            yield* Ref.update(cancellationCalls, (count) => count + 1)
            return WorkspaceRunCancellationResult.cases.NothingActive.make({})
          }),
          kickObjectCleanup: Effect.fn("WorkspaceRunCancellation.DeleteTest.kickObjectCleanup")(
            () => Ref.update(cleanupKicks, (count) => count + 1),
          ),
        }),
      )
      const dependencies = Layer.mergeAll(
        authLayer,
        unusedWorkspaceLayer,
        unusedOnboardingLayer,
        deletions.layer,
        cancellationLayer,
        CoachOnboardingToken.testLayer("PraximoBot"),
        ManagerBotSender.testLayer,
        CoachBotRelease.testLayer,
      )
      const appLayer = Layer.provideMerge(AdminSurface.layer, dependencies)

      yield* Effect.gen(function* () {
        const admin = yield* AdminSurface.Service
        const result = yield* admin.deleteWorkspace("valid", workspaceId, { requestId })
        const replay = yield* admin.deleteWorkspace("valid", workspaceId, { requestId })
        const progress = yield* admin.getWorkspaceDeletion("valid", workspaceId)
        const messages = yield* ManagerBotSender.TestService.pipe(
          Effect.flatMap((sender) => sender.sent()),
        )
        const releases = yield* CoachBotRelease.TestService.pipe(
          Effect.flatMap((release) => release.released()),
        )

        expect(result).toEqual({ status: "deleted" })
        expect(replay).toEqual({ status: "deleted" })
        expect((yield* deletions.operation).state).toBe("completed")
        // The receipt outlives the workspace, so the progress surface can watch
        // the last stage land instead of losing its subject at the cascade.
        expect(progress).toMatchObject({
          workspaceId,
          state: "completed",
          pipeline: "nothing-active",
          farewell: "sent",
          botRelease: "not-connected",
        })
        expect(yield* Ref.get(cancellationCalls)).toBe(1)
        expect(yield* Ref.get(cleanupKicks)).toBe(1)
        expect(messages).toEqual([
          {
            recipient: adminTelegramId,
            text: "Your Praximo workspace “Ada Coaching” has been deleted. The bot is no longer connected to Praximo.",
          },
        ])
        expect(releases).toEqual([workspaceId])
      }).pipe(Effect.provide(appLayer))
    }),
  )

  it.effect("says goodbye without quoting a label the workspace never had", () =>
    Effect.gen(function* () {
      // An invite-first workspace the admin never labelled. Its empty name is a
      // real value that reaches the coach's farewell, so the message drops the
      // quotes rather than shipping «» to a person.
      const deletions = yield* deletionRepoDouble({ ...pendingOperation, workspaceName: "" })
      const cancellationLayer = Layer.succeed(
        WorkspaceRunCancellation.Service,
        WorkspaceRunCancellation.Service.of({
          cancel: Effect.fn("WorkspaceRunCancellation.UnnamedTest.cancel")(() =>
            Effect.succeed(WorkspaceRunCancellationResult.cases.NothingActive.make({})),
          ),
          kickObjectCleanup: Effect.fn("WorkspaceRunCancellation.UnnamedTest.kick")(
            () => Effect.void,
          ),
        }),
      )
      const appLayer = Layer.provideMerge(
        AdminSurface.layer,
        Layer.mergeAll(
          authLayer,
          unusedWorkspaceLayer,
          unusedOnboardingLayer,
          deletions.layer,
          cancellationLayer,
          CoachOnboardingToken.testLayer("PraximoBot"),
          ManagerBotSender.testLayer,
          CoachBotRelease.testLayer,
        ),
      )

      yield* Effect.gen(function* () {
        const admin = yield* AdminSurface.Service
        yield* admin.deleteWorkspace("valid", workspaceId, { requestId })
        const messages = yield* ManagerBotSender.TestService.pipe(
          Effect.flatMap((sender) => sender.sent()),
        )

        expect(messages).toEqual([
          {
            recipient: adminTelegramId,
            text: "Your Praximo workspace has been deleted. The bot is no longer connected to Praximo.",
          },
        ])
      }).pipe(Effect.provide(appLayer))
    }),
  )

  it.effect("adopts an interrupted operation and resumes it by its own requestId", () =>
    Effect.gen(function* () {
      // The client mints a fresh requestId on the retry after an interruption.
      const freshRequestId = WorkspaceDeletionRequestId.make("f1e2d3c4-b5a6-4788-99aa-bbccddeeff00")
      const deletions = yield* deletionRepoDouble({
        ...pendingOperation,
        pipelineStatus: "cancelled",
        farewellStatus: "sent",
        updatedAt: new Date("2026-07-23T12:03:00.000Z"),
      })
      const cancellationLayer = Layer.succeed(
        WorkspaceRunCancellation.Service,
        WorkspaceRunCancellation.Service.of({
          cancel: Effect.fn("WorkspaceRunCancellation.AdoptTest.cancel")(() =>
            Effect.succeed(WorkspaceRunCancellationResult.cases.NothingActive.make({})),
          ),
          kickObjectCleanup: Effect.fn("WorkspaceRunCancellation.AdoptTest.kickObjectCleanup")(
            () => Effect.void,
          ),
        }),
      )
      const dependencies = Layer.mergeAll(
        authLayer,
        unusedWorkspaceLayer,
        unusedOnboardingLayer,
        deletions.layer,
        cancellationLayer,
        CoachOnboardingToken.testLayer("PraximoBot"),
        ManagerBotSender.testLayer,
        CoachBotRelease.testLayer,
      )
      const appLayer = Layer.provideMerge(AdminSurface.layer, dependencies)

      yield* Effect.gen(function* () {
        const admin = yield* AdminSurface.Service
        const result = yield* admin.deleteWorkspace("valid", workspaceId, {
          requestId: freshRequestId,
        })

        expect(result).toEqual({ status: "deleted" })
        expect((yield* deletions.operation).state).toBe("completed")
        // Terminal stages (pipeline, farewell) are not re-run; only bot-release
        // and finalize execute, both against the adopted operation's requestId.
        expect(yield* deletions.driverRequestIds).toEqual([requestId, requestId])
      }).pipe(Effect.provide(appLayer))
    }),
  )

  it.effect("reports the driver lease, not a guess, as the pipeline being driven", () =>
    Effect.gen(function* () {
      // Held for another minute by an attempt running somewhere else. The
      // remaining time is what crosses the wire — an instant would be read
      // against the client's own clock, which may disagree with the server's.
      const held = yield* deletionRepoDouble({
        ...pendingOperation,
        leaseUntil: new Date(60_000),
      })
      const free = yield* deletionRepoDouble(pendingOperation)

      const read = (deletions: { readonly layer: Layer.Layer<WorkspaceDeletionRepo.Service> }) =>
        Effect.gen(function* () {
          const admin = yield* AdminSurface.Service
          return yield* admin.getWorkspaceDeletion("valid", workspaceId)
        }).pipe(
          Effect.provide(
            Layer.provideMerge(
              AdminSurface.layer,
              Layer.mergeAll(
                authLayer,
                unusedWorkspaceLayer,
                unusedOnboardingLayer,
                deletions.layer,
                unusedCancellationLayer,
                CoachOnboardingToken.testLayer("PraximoBot"),
                ManagerBotSender.testLayer,
                CoachBotRelease.testLayer,
              ),
            ),
          ),
        )

      expect((yield* read(held))?.drivingLapsesInMs).toBe(60_000)
      expect((yield* read(free))?.drivingLapsesInMs).toBe(0)
    }),
  )

  it.effect("lets a single attempt drive a contested operation, and only that one", () =>
    Effect.gen(function* () {
      const deletions = yield* deletionRepoDouble(pendingOperation)
      const cancellationCalls = yield* Ref.make(0)
      const cancellationLayer = Layer.succeed(
        WorkspaceRunCancellation.Service,
        WorkspaceRunCancellation.Service.of({
          cancel: Effect.fn("WorkspaceRunCancellation.RaceTest.cancel")(function* () {
            yield* Ref.update(cancellationCalls, (count) => count + 1)
            return WorkspaceRunCancellationResult.cases.NothingActive.make({})
          }),
          kickObjectCleanup: Effect.fn("WorkspaceRunCancellation.RaceTest.kickObjectCleanup")(
            () => Effect.void,
          ),
        }),
      )
      const dependencies = Layer.mergeAll(
        authLayer,
        unusedWorkspaceLayer,
        unusedOnboardingLayer,
        deletions.layer,
        cancellationLayer,
        CoachOnboardingToken.testLayer("PraximoBot"),
        ManagerBotSender.testLayer,
        CoachBotRelease.testLayer,
      )
      const appLayer = Layer.provideMerge(AdminSurface.layer, dependencies)

      yield* Effect.gen(function* () {
        const admin = yield* AdminSurface.Service
        // A double submit from one dialog: the same requestId, so nothing in
        // the client's payload can tell the two attempts apart.
        const attempt = () =>
          admin.deleteWorkspace("valid", workspaceId, { requestId }).pipe(Effect.result)
        const attempts = yield* Effect.all([attempt(), attempt()], {
          concurrency: "unbounded",
        })
        const messages = yield* ManagerBotSender.TestService.pipe(
          Effect.flatMap((sender) => sender.sent()),
        )
        const releases = yield* CoachBotRelease.TestService.pipe(
          Effect.flatMap((release) => release.released()),
        )

        // The farewell is the unrecoverable one: a coach told goodbye twice
        // cannot be untold.
        expect(messages).toHaveLength(1)
        expect(releases).toEqual([workspaceId])
        expect(yield* Ref.get(cancellationCalls)).toBe(1)

        const succeeded = attempts.filter(Result.isSuccess)
        const failed = attempts.filter(Result.isFailure)
        expect(succeeded.map((outcome) => outcome.success)).toEqual([{ status: "deleted" }])
        expect(failed.map((outcome) => outcome.failure._tag)).toEqual([
          "AdminSurface.DeletionConflict",
        ])
        expect((yield* deletions.operation).state).toBe("completed")
      }).pipe(Effect.provide(appLayer))
    }),
  )
})
