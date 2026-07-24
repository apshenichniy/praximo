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
import { CoachBotBranding, CoachBotRelease, ManagerBotSender } from "@praximo/telegram"
import { Effect, Layer, Ref } from "effect"
import { AdminSurface } from "./admin-surface.ts"
import { WorkspaceBrandingStorage } from "./workspace-branding-storage.ts"
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
    updateProfile: Effect.fn("WorkspaceRepo.DeleteTest.updateProfile")(() => Effect.die("unused")),
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

describe("AdminSurface workspace deletion", () => {
  it.effect("runs the required saga once and returns an idempotent completed result", () =>
    Effect.gen(function* () {
      const state = yield* Ref.make<WorkspaceDeletionRepo.Operation | undefined>(undefined)
      const cancellationCalls = yield* Ref.make(0)
      const cleanupKicks = yield* Ref.make(0)
      const initial: WorkspaceDeletionRepo.Operation = {
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

      const update = Effect.fn("WorkspaceDeletionRepo.DeleteTest.update")(function* (
        values: Partial<WorkspaceDeletionRepo.Operation>,
        now: Date,
      ) {
        const current = yield* Ref.get(state)
        if (current === undefined) return yield* Effect.die("operation missing")
        const next = { ...current, ...values, updatedAt: now }
        yield* Ref.set(state, next)
        return next
      })
      const deletionLayer = Layer.succeed(
        WorkspaceDeletionRepo.Service,
        WorkspaceDeletionRepo.Service.of({
          prepare: Effect.fn("WorkspaceDeletionRepo.DeleteTest.prepare")(
            function* (_workspaceId, _requestId, confirmationName) {
              if (confirmationName !== initial.workspaceName) {
                return yield* new WorkspaceDeletionRepo.NameMismatch()
              }
              const current = yield* Ref.get(state)
              if (current !== undefined) return current
              yield* Ref.set(state, initial)
              return initial
            },
          ),
          markPipeline: Effect.fn("WorkspaceDeletionRepo.DeleteTest.markPipeline")(
            (_requestId, status, now) => update({ pipelineStatus: status }, now),
          ),
          markFarewell: Effect.fn("WorkspaceDeletionRepo.DeleteTest.markFarewell")(
            (_requestId, status, now) => update({ farewellStatus: status }, now),
          ),
          markBotReleased: Effect.fn("WorkspaceDeletionRepo.DeleteTest.markBotReleased")(
            (_requestId, status, now) => update({ botReleaseStatus: status }, now),
          ),
          finalize: Effect.fn("WorkspaceDeletionRepo.DeleteTest.finalize")((_requestId, now) =>
            update({ state: "completed", completedAt: now }, now),
          ),
          isDeleting: Effect.fn("WorkspaceDeletionRepo.DeleteTest.isDeleting")(() =>
            Effect.succeed(true),
          ),
          purgeExpired: Effect.fn("WorkspaceDeletionRepo.DeleteTest.purgeExpired")(() =>
            Effect.succeed(0),
          ),
          reconcileOrphans: Effect.fn("WorkspaceDeletionRepo.DeleteTest.reconcileOrphans")(() =>
            Effect.succeed(0),
          ),
        }),
      )
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
        deletionLayer,
        cancellationLayer,
        CoachOnboardingToken.testLayer("PraximoMotherBot"),
        WorkspaceBrandingStorage.testLayer({
          defaultAvatarKey: "branding/default-coach-avatar.jpg",
        }),
        ManagerBotSender.testLayer,
        CoachBotBranding.testLayer,
        CoachBotRelease.testLayer,
      )
      const appLayer = Layer.provideMerge(AdminSurface.layer, dependencies)

      yield* Effect.gen(function* () {
        const admin = yield* AdminSurface.Service
        const result = yield* admin.deleteWorkspace("valid", workspaceId, {
          requestId,
          confirmationName: "Ada Coaching",
        })
        const replay = yield* admin.deleteWorkspace("valid", workspaceId, {
          requestId,
          confirmationName: "Ada Coaching",
        })
        const messages = yield* ManagerBotSender.TestService.pipe(
          Effect.flatMap((sender) => sender.sent()),
        )
        const releases = yield* CoachBotRelease.TestService.pipe(
          Effect.flatMap((release) => release.released()),
        )

        expect(result).toEqual({ status: "deleted" })
        expect(replay).toEqual({ status: "deleted" })
        expect((yield* Ref.get(state))?.state).toBe("completed")
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

  it.effect("adopts an interrupted operation and resumes it by its own requestId", () =>
    Effect.gen(function* () {
      // The client mints a fresh requestId on the retry after an interruption.
      const freshRequestId = WorkspaceDeletionRequestId.make("f1e2d3c4-b5a6-4788-99aa-bbccddeeff00")
      const adopted: WorkspaceDeletionRepo.Operation = {
        requestId,
        workspaceId,
        state: "prepared",
        pipelineStatus: "cancelled",
        farewellStatus: "sent",
        botReleaseStatus: "pending",
        createdAt: new Date("2026-07-23T12:00:00.000Z"),
        updatedAt: new Date("2026-07-23T12:03:00.000Z"),
        workspaceName: "Ada Coaching",
        coachTelegramId: adminTelegramId,
        coachLanguage: CoachLanguage.make("en"),
      }
      const state = yield* Ref.make<WorkspaceDeletionRepo.Operation>(adopted)
      const seenRequestIds = yield* Ref.make<ReadonlyArray<string>>([])

      const step = Effect.fn("WorkspaceDeletionRepo.AdoptTest.step")(function* (
        stepRequestId: string,
        values: Partial<WorkspaceDeletionRepo.Operation>,
        now: Date,
      ) {
        yield* Ref.update(seenRequestIds, (ids) => [...ids, stepRequestId])
        const next = { ...(yield* Ref.get(state)), ...values, updatedAt: now }
        yield* Ref.set(state, next)
        return next
      })

      const deletionLayer = Layer.succeed(
        WorkspaceDeletionRepo.Service,
        WorkspaceDeletionRepo.Service.of({
          // Adoption: the fresh requestId never matches, so prepare returns the
          // existing operation, which still carries the original requestId.
          prepare: Effect.fn("WorkspaceDeletionRepo.AdoptTest.prepare")(() => Ref.get(state)),
          markPipeline: Effect.fn("WorkspaceDeletionRepo.AdoptTest.markPipeline")(
            (stepRequestId, status, now) => step(stepRequestId, { pipelineStatus: status }, now),
          ),
          markFarewell: Effect.fn("WorkspaceDeletionRepo.AdoptTest.markFarewell")(
            (stepRequestId, status, now) => step(stepRequestId, { farewellStatus: status }, now),
          ),
          markBotReleased: Effect.fn("WorkspaceDeletionRepo.AdoptTest.markBotReleased")(
            (stepRequestId, status, now) => step(stepRequestId, { botReleaseStatus: status }, now),
          ),
          finalize: Effect.fn("WorkspaceDeletionRepo.AdoptTest.finalize")((stepRequestId, now) =>
            step(stepRequestId, { state: "completed", completedAt: now }, now),
          ),
          isDeleting: Effect.fn("WorkspaceDeletionRepo.AdoptTest.isDeleting")(() =>
            Effect.succeed(true),
          ),
          purgeExpired: Effect.fn("WorkspaceDeletionRepo.AdoptTest.purgeExpired")(() =>
            Effect.succeed(0),
          ),
          reconcileOrphans: Effect.fn("WorkspaceDeletionRepo.AdoptTest.reconcileOrphans")(() =>
            Effect.succeed(0),
          ),
        }),
      )
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
        deletionLayer,
        cancellationLayer,
        CoachOnboardingToken.testLayer("PraximoMotherBot"),
        WorkspaceBrandingStorage.testLayer({
          defaultAvatarKey: "branding/default-coach-avatar.jpg",
        }),
        ManagerBotSender.testLayer,
        CoachBotBranding.testLayer,
        CoachBotRelease.testLayer,
      )
      const appLayer = Layer.provideMerge(AdminSurface.layer, dependencies)

      yield* Effect.gen(function* () {
        const admin = yield* AdminSurface.Service
        const result = yield* admin.deleteWorkspace("valid", workspaceId, {
          requestId: freshRequestId,
          confirmationName: "Ada Coaching",
        })

        expect(result).toEqual({ status: "deleted" })
        expect((yield* Ref.get(state)).state).toBe("completed")
        // Terminal stages (pipeline, farewell) are not re-run; only bot-release
        // and finalize execute, both against the adopted operation's requestId.
        expect(yield* Ref.get(seenRequestIds)).toEqual([requestId, requestId])
      }).pipe(Effect.provide(appLayer))
    }),
  )
})
