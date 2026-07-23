import { createHash } from "node:crypto"
import { describe, expect, it } from "@effect/vitest"
import { CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import { AdminRepo, CoachOnboardingRepo, QueryFailed, WorkspaceRepo } from "@praximo/db"
import {
  Admin,
  AdminId,
  AdminNotFound,
  CoachLanguage,
  CoachOnboardingInviteId,
  TelegramId,
  WorkspaceId,
  WorkspaceNotFound,
} from "@praximo/domain"
import { ConfigProvider, Effect, Layer, Ref } from "effect"
import { ManagerBotSender } from "@praximo/telegram"
import * as TestClock from "effect/testing/TestClock"
import { encode } from "jpeg-js"
import { AdminSurface } from "./admin-surface.ts"
import { WorkspaceBrandingStorage } from "./workspace-branding-storage.ts"

const MANAGER_BOT_TOKEN = "123456789:AAExampleTestToken"
const VALID_INIT_DATA =
  "auth_date=1784808000&query_id=AAEAAAE&user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Ada%22%2C%22username%22%3A%22ada_coach%22%7D&hash=e7f020d802315d3769a8d0602381fa7edc6f09807cd4a735b433e05871253e06"

const adminTelegramId = TelegramId.make("123456789")

const adminRepoLayer = Layer.succeed(
  AdminRepo.Service,
  AdminRepo.Service.of({
    upsertByTelegramId: Effect.fn("AdminRepo.Test.upsertByTelegramId")((telegramId) =>
      Effect.succeed(Admin.make({ id: AdminId.make(`adm_${telegramId}`), telegramId })),
    ),
    findByTelegramId: Effect.fn("AdminRepo.Test.findByTelegramId")(function* (telegramId) {
      if (telegramId !== adminTelegramId) {
        return yield* Effect.fail(new AdminNotFound({ telegramId }))
      }
      return Admin.make({ id: AdminId.make("adm_test"), telegramId })
    }),
  }),
)

const workspaceRows = [
  WorkspaceRepo.ListItem.make({
    id: WorkspaceId.make("ws_ada"),
    name: "Ada Coaching",
    botStatus: "connected",
    botUsername: "ada_coach_bot",
    hasCustomAvatar: false,
  }),
]

const createdAggregate: CoachOnboardingRepo.Aggregate = {
  workspace: {
    id: WorkspaceId.make("ws_cb6bd55960914d69aeff2af000354c7f"),
    name: "Ada Coaching",
  },
  owner: { language: CoachLanguage.make("uk") },
  invite: {
    id: CoachOnboardingInviteId.make("ci_cb6bd55960914d69aeff2af000"),
    workspaceId: WorkspaceId.make("ws_cb6bd55960914d69aeff2af000354c7f"),
    status: "pending",
    issuedAt: new Date("2026-07-23T12:01:00.000Z"),
    expiresAt: new Date("2026-07-30T12:01:00.000Z"),
  },
}

const workspaceRepoLayer = (rows: ReadonlyArray<WorkspaceRepo.ListItem>) =>
  Layer.succeed(
    WorkspaceRepo.Service,
    WorkspaceRepo.Service.of({
      create: Effect.fn("WorkspaceRepo.Test.create")((workspace) => Effect.succeed(workspace)),
      findById: Effect.fn("WorkspaceRepo.Test.findById")((id) =>
        Effect.fail(new WorkspaceNotFound({ id })),
      ),
      list: Effect.fn("WorkspaceRepo.Test.list")(() => Effect.succeed(rows)),
    }),
  )

const testConfig = ConfigProvider.layer(ConfigProvider.fromUnknown({ MANAGER_BOT_TOKEN }))

const onboardingRepoLayer = Layer.succeed(
  CoachOnboardingRepo.Service,
  CoachOnboardingRepo.Service.of({
    lookupCreate: Effect.fn("CoachOnboardingRepo.Test.lookupCreate")(() =>
      Effect.die("unused in list tests"),
    ),
    createOrGet: Effect.fn("CoachOnboardingRepo.Test.createOrGet")(() =>
      Effect.die("unused in list tests"),
    ),
    findInvite: Effect.fn("CoachOnboardingRepo.Test.findInvite")(() =>
      Effect.die("unused in list tests"),
    ),
    verifyPending: Effect.fn("CoachOnboardingRepo.Test.verifyPending")(() =>
      Effect.die("unused in list tests"),
    ),
    markUsed: Effect.fn("CoachOnboardingRepo.Test.markUsed")(() =>
      Effect.die("unused in list tests"),
    ),
  }),
)

const successfulOnboardingRepoLayer = Layer.succeed(
  CoachOnboardingRepo.Service,
  CoachOnboardingRepo.Service.of({
    lookupCreate: Effect.fn("CoachOnboardingRepo.Test.lookupCreate")(() =>
      Effect.succeed(undefined),
    ),
    createOrGet: Effect.fn("CoachOnboardingRepo.Test.createOrGet")(() =>
      Effect.succeed({ aggregate: createdAggregate, created: true }),
    ),
    findInvite: Effect.fn("CoachOnboardingRepo.Test.findInvite")(() =>
      Effect.succeed(createdAggregate),
    ),
    verifyPending: Effect.fn("CoachOnboardingRepo.Test.verifyPending")(() =>
      Effect.succeed(createdAggregate),
    ),
    markUsed: Effect.fn("CoachOnboardingRepo.Test.markUsed")(() =>
      Effect.succeed(createdAggregate.invite),
    ),
  }),
)

const replayOnboardingRepoLayer = Layer.succeed(
  CoachOnboardingRepo.Service,
  CoachOnboardingRepo.Service.of({
    lookupCreate: Effect.fn("CoachOnboardingRepo.Test.lookupCreate")(() =>
      Effect.succeed({ aggregate: createdAggregate, created: false }),
    ),
    createOrGet: Effect.fn("CoachOnboardingRepo.Test.createOrGet")(() =>
      Effect.die("replay must not create"),
    ),
    findInvite: Effect.fn("CoachOnboardingRepo.Test.findInvite")(() =>
      Effect.succeed(createdAggregate),
    ),
    verifyPending: Effect.fn("CoachOnboardingRepo.Test.verifyPending")(() =>
      Effect.succeed(createdAggregate),
    ),
    markUsed: Effect.fn("CoachOnboardingRepo.Test.markUsed")(() =>
      Effect.succeed(createdAggregate.invite),
    ),
  }),
)

const failingOnboardingRepoLayer = Layer.succeed(
  CoachOnboardingRepo.Service,
  CoachOnboardingRepo.Service.of({
    lookupCreate: Effect.fn("CoachOnboardingRepo.Test.lookupCreate")(() =>
      Effect.succeed(undefined),
    ),
    createOrGet: Effect.fn("CoachOnboardingRepo.Test.createOrGet")(() =>
      Effect.fail(new QueryFailed({ operation: "test", cause: new Error("database failed") })),
    ),
    findInvite: Effect.fn("CoachOnboardingRepo.Test.findInvite")(() =>
      Effect.succeed(createdAggregate),
    ),
    verifyPending: Effect.fn("CoachOnboardingRepo.Test.verifyPending")(() =>
      Effect.succeed(createdAggregate),
    ),
    markUsed: Effect.fn("CoachOnboardingRepo.Test.markUsed")(() =>
      Effect.succeed(createdAggregate.invite),
    ),
  }),
)

const outcomeUnknownOnboardingRepoLayer = Layer.effect(
  CoachOnboardingRepo.Service,
  Effect.gen(function* () {
    const lookups = yield* Ref.make(0)
    return CoachOnboardingRepo.Service.of({
      lookupCreate: Effect.fn("CoachOnboardingRepo.Test.lookupCreate")(function* () {
        const attempt = yield* Ref.updateAndGet(lookups, (count) => count + 1)
        if (attempt === 1) return undefined
        return yield* new QueryFailed({
          operation: "test.reconcile",
          cause: new Error("database unavailable"),
        })
      }),
      createOrGet: Effect.fn("CoachOnboardingRepo.Test.createOrGet")(() =>
        Effect.fail(
          new QueryFailed({ operation: "test.create", cause: new Error("outcome unknown") }),
        ),
      ),
      findInvite: Effect.fn("CoachOnboardingRepo.Test.findInvite")(() =>
        Effect.succeed(createdAggregate),
      ),
      verifyPending: Effect.fn("CoachOnboardingRepo.Test.verifyPending")(() =>
        Effect.succeed(createdAggregate),
      ),
      markUsed: Effect.fn("CoachOnboardingRepo.Test.markUsed")(() =>
        Effect.succeed(createdAggregate.invite),
      ),
    })
  }),
)

const createDependencies = Layer.mergeAll(
  onboardingRepoLayer,
  CoachOnboardingToken.testLayer("test-secret", "PraximoMotherBot"),
  WorkspaceBrandingStorage.testLayer({
    defaultAvatarKey: "branding/default-coach-avatar.jpg",
  }),
  ManagerBotSender.testLayer,
)

const appLayer = (rows: ReadonlyArray<WorkspaceRepo.ListItem>) =>
  AdminSurface.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ManagerInitData.layer,
        adminRepoLayer,
        workspaceRepoLayer(rows),
        createDependencies,
      ),
    ),
  )

const createAppLayer = Layer.provideMerge(
  AdminSurface.layer,
  Layer.mergeAll(
    ManagerInitData.layer,
    adminRepoLayer,
    workspaceRepoLayer([]),
    successfulOnboardingRepoLayer,
    CoachOnboardingToken.testLayer("test-secret", "PraximoMotherBot"),
    WorkspaceBrandingStorage.testLayer({
      defaultAvatarKey: "branding/default-coach-avatar.jpg",
    }),
    ManagerBotSender.testLayer,
  ),
)

const createLayerWith = (onboardingLayer: Layer.Layer<CoachOnboardingRepo.Service>) =>
  Layer.provideMerge(
    AdminSurface.layer,
    Layer.mergeAll(
      ManagerInitData.layer,
      adminRepoLayer,
      workspaceRepoLayer([]),
      onboardingLayer,
      CoachOnboardingToken.testLayer("test-secret", "PraximoMotherBot"),
      WorkspaceBrandingStorage.testLayer({
        defaultAvatarKey: "branding/default-coach-avatar.jpg",
      }),
      ManagerBotSender.testLayer,
    ),
  )

const validAvatar = new Uint8Array(
  encode({ width: 512, height: 512, data: new Uint8Array(512 * 512 * 4).fill(255) }, 50).data,
)
const validAvatarKey = `workspace-branding/cb6bd559-6091-4d69-aeff-2af000354c7f/${createHash("sha256").update(validAvatar).digest("hex")}.jpg`

const conflictingOnboardingRepoLayer = (existingAvatarR2Key: string) =>
  Layer.effect(
    CoachOnboardingRepo.Service,
    Effect.gen(function* () {
      const lookups = yield* Ref.make(0)
      const conflict = () =>
        new CoachOnboardingRepo.IdempotencyConflict({
          requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
          existingAvatarR2Key,
        })
      return CoachOnboardingRepo.Service.of({
        lookupCreate: Effect.fn("CoachOnboardingRepo.Test.lookupCreate")(function* () {
          const attempt = yield* Ref.updateAndGet(lookups, (count) => count + 1)
          return attempt === 1 ? undefined : yield* conflict()
        }),
        createOrGet: Effect.fn("CoachOnboardingRepo.Test.createOrGet")(() =>
          Effect.fail(conflict()),
        ),
        findInvite: Effect.fn("CoachOnboardingRepo.Test.findInvite")(() =>
          Effect.succeed(createdAggregate),
        ),
        verifyPending: Effect.fn("CoachOnboardingRepo.Test.verifyPending")(() =>
          Effect.succeed(createdAggregate),
        ),
        markUsed: Effect.fn("CoachOnboardingRepo.Test.markUsed")(() =>
          Effect.succeed(createdAggregate.invite),
        ),
      })
    }),
  )

const nonAdminVerifierLayer = Layer.succeed(
  ManagerInitData.Service,
  ManagerInitData.Service.of({
    verify: Effect.fn("ManagerInitData.Test.verify")(() =>
      Effect.succeed(TelegramId.make("987654321")),
    ),
  }),
)

const nonAdminLayer = AdminSurface.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      nonAdminVerifierLayer,
      adminRepoLayer,
      workspaceRepoLayer([]),
      createDependencies,
    ),
  ),
)

describe("AdminSurface", () => {
  it.effect("returns workspace rows to a verified platform admin", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service

      expect(yield* adminSurface.listWorkspaces(VALID_INIT_DATA)).toEqual(workspaceRows)
    }).pipe(Effect.provide(appLayer(workspaceRows)), Effect.provide(testConfig)),
  )

  it.effect("returns an empty list to a verified admin when no workspaces exist", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service

      expect(yield* adminSurface.listWorkspaces(VALID_INIT_DATA)).toEqual([])
    }).pipe(Effect.provide(appLayer([])), Effect.provide(testConfig)),
  )

  it.effect("denies authentic initData for a Telegram id outside the admin set", () =>
    Effect.gen(function* () {
      const adminSurface = yield* AdminSurface.Service
      const error = yield* Effect.flip(adminSurface.listWorkspaces("authentic-non-admin"))

      expect(error._tag).toBe("AdminSurface.AccessDenied")
    }).pipe(Effect.provide(nonAdminLayer)),
  )

  it.effect("denies forged or expired manager initData without returning workspace data", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-24T12:00:01.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const expired = yield* Effect.flip(adminSurface.listWorkspaces(VALID_INIT_DATA))
      const forged = yield* Effect.flip(
        adminSurface.listWorkspaces(VALID_INIT_DATA.replace("hash=e7f0", "hash=07f0")),
      )

      expect(expired._tag).toBe("AdminSurface.AccessDenied")
      expect(forged._tag).toBe("AdminSurface.AccessDenied")
    }).pipe(Effect.provide(appLayer(workspaceRows)), Effect.provide(testConfig)),
  )

  it.effect("creates the aggregate and sends a coach-language forwardable message", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.createWorkspace(VALID_INIT_DATA, {
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        name: "  Ada Coaching  ",
        coachLanguage: "uk",
      })
      const sender = yield* ManagerBotSender.TestService

      expect(result).toMatchObject({
        workspace: {
          id: "ws_cb6bd55960914d69aeff2af000354c7f",
          name: "Ada Coaching",
          botStatus: "provisioning",
          hasCustomAvatar: false,
        },
        delivery: "sent",
      })
      expect(result.link).toContain("https://t.me/PraximoMotherBot?start=ws_")
      expect(yield* sender.sent()).toEqual([
        {
          recipient: adminTelegramId,
          text: expect.stringContaining("Ваш простір Praximo"),
        },
      ])
    }).pipe(Effect.provide(createAppLayer), Effect.provide(testConfig)),
  )

  it.effect("keeps the committed result and copyable link when Telegram delivery fails", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const sender = yield* ManagerBotSender.TestService
      yield* sender.failNextSend(
        new ManagerBotSender.SendFailed({
          recipient: adminTelegramId,
          category: "transport",
        }),
      )
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.createWorkspace(VALID_INIT_DATA, {
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        name: "Ada Coaching",
        coachLanguage: "uk",
      })

      expect(result.delivery).toBe("failed")
      expect(result.link).toContain("?start=")
    }).pipe(Effect.provide(createAppLayer), Effect.provide(testConfig)),
  )

  it.effect("returns an idempotent replay without uploading or redelivering the avatar", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.createWorkspace(
        VALID_INIT_DATA,
        {
          requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
          name: "Ada Coaching",
          coachLanguage: "uk",
        },
        validAvatar,
      )
      const storage = yield* WorkspaceBrandingStorage.TestService
      const sender = yield* ManagerBotSender.TestService

      expect(result.delivery).toBe("unknown")
      expect(yield* storage.puts()).toEqual([])
      expect(yield* sender.sent()).toEqual([])
    }).pipe(Effect.provide(createLayerWith(replayOnboardingRepoLayer)), Effect.provide(testConfig)),
  )

  it.effect("best-effort deletes an isolated avatar when database creation fails", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const error = yield* Effect.flip(
        adminSurface.createWorkspace(
          VALID_INIT_DATA,
          {
            requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
            name: "Ada Coaching",
            coachLanguage: "uk",
          },
          validAvatar,
        ),
      )
      const storage = yield* WorkspaceBrandingStorage.TestService
      const puts = yield* storage.puts()

      expect(error._tag).toBe("AdminSurface.LoadFailed")
      expect(puts).toHaveLength(1)
      expect(yield* storage.deletes()).toEqual([puts[0]?.key])
    }).pipe(
      Effect.provide(createLayerWith(failingOnboardingRepoLayer)),
      Effect.provide(testConfig),
    ),
  )

  it.effect("preserves a possibly committed avatar when reconciliation also fails", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const error = yield* Effect.flip(
        adminSurface.createWorkspace(
          VALID_INIT_DATA,
          {
            requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
            name: "Ada Coaching",
            coachLanguage: "uk",
          },
          validAvatar,
        ),
      )
      const storage = yield* WorkspaceBrandingStorage.TestService

      expect(error._tag).toBe("AdminSurface.LoadFailed")
      expect(yield* storage.puts()).toHaveLength(1)
      expect(yield* storage.deletes()).toEqual([])
    }).pipe(
      Effect.provide(createLayerWith(outcomeUnknownOnboardingRepoLayer)),
      Effect.provide(testConfig),
    ),
  )

  it.effect("preserves a winner avatar when a conflicting request uploaded the same key", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const error = yield* Effect.flip(
        adminSurface.createWorkspace(
          VALID_INIT_DATA,
          {
            requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
            name: "Conflicting name",
            coachLanguage: "uk",
          },
          validAvatar,
        ),
      )
      const storage = yield* WorkspaceBrandingStorage.TestService

      expect(error._tag).toBe("AdminSurface.IdempotencyConflict")
      expect(yield* storage.deletes()).toEqual([])
    }).pipe(
      Effect.provide(createLayerWith(conflictingOnboardingRepoLayer(validAvatarKey))),
      Effect.provide(testConfig),
    ),
  )

  it.effect("deletes its avatar when a conflict references a different content key", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const error = yield* Effect.flip(
        adminSurface.createWorkspace(
          VALID_INIT_DATA,
          {
            requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
            name: "Conflicting avatar",
            coachLanguage: "uk",
          },
          validAvatar,
        ),
      )
      const storage = yield* WorkspaceBrandingStorage.TestService

      expect(error._tag).toBe("AdminSurface.IdempotencyConflict")
      expect(yield* storage.deletes()).toEqual([validAvatarKey])
    }).pipe(
      Effect.provide(
        createLayerWith(
          conflictingOnboardingRepoLayer("workspace-branding/existing/different.jpg"),
        ),
      ),
      Effect.provide(testConfig),
    ),
  )
})
