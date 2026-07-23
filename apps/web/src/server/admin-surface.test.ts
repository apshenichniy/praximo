import { describe, expect, it } from "@effect/vitest"
import { ManagerInitData } from "@praximo/auth"
import { AdminRepo, WorkspaceRepo } from "@praximo/db"
import {
  Admin,
  AdminId,
  AdminNotFound,
  TelegramId,
  WorkspaceId,
  WorkspaceNotFound,
} from "@praximo/domain"
import { ConfigProvider, Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { AdminSurface } from "./admin-surface.ts"

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
  }),
]

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

const appLayer = (rows: ReadonlyArray<WorkspaceRepo.ListItem>) =>
  AdminSurface.layer.pipe(
    Layer.provide(Layer.mergeAll(ManagerInitData.layer, adminRepoLayer, workspaceRepoLayer(rows))),
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
  Layer.provide(Layer.mergeAll(nonAdminVerifierLayer, adminRepoLayer, workspaceRepoLayer([]))),
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
})
