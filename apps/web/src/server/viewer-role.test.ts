import { describe, expect, it } from "@effect/vitest"
import { CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import { AdminRepo, QueryFailed, WorkspaceRepo } from "@praximo/db"
import {
  Admin,
  AdminId,
  AdminNotFound,
  CoachOnboardingInviteCode,
  TelegramId,
  WorkspaceId,
} from "@praximo/domain"
import { ConfigProvider, Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { ViewerRole } from "./viewer-role.ts"

const MANAGER_BOT_TOKEN = "123456789:AAExampleTestToken"
// The same signed launch credential the admin-surface tests use: Telegram id
// 123456789, signed against MANAGER_BOT_TOKEN with auth_date inside the window
// the clock below is pinned to.
const VALID_INIT_DATA =
  "auth_date=1784808000&query_id=AAEAAAE&user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Ada%22%2C%22username%22%3A%22ada_coach%22%7D&hash=e7f020d802315d3769a8d0602381fa7edc6f09807cd4a735b433e05871253e06"
const NOW = "2026-07-23T12:01:00.000Z"

const viewer = TelegramId.make("123456789")
const workspaceId = WorkspaceId.make("ws_ada")

const adminRepoLayer = (admins: ReadonlyArray<TelegramId>) =>
  Layer.succeed(
    AdminRepo.Service,
    AdminRepo.Service.of({
      upsertByTelegramId: Effect.fn("AdminRepo.Test.upsertByTelegramId")((telegramId) =>
        Effect.succeed(Admin.make({ id: AdminId.make(`adm_${telegramId}`), telegramId })),
      ),
      findByTelegramId: Effect.fn("AdminRepo.Test.findByTelegramId")(function* (telegramId) {
        if (!admins.includes(telegramId)) {
          return yield* Effect.fail(new AdminNotFound({ telegramId }))
        }
        return Admin.make({ id: AdminId.make("adm_test"), telegramId })
      }),
    }),
  )

const workspaceRepoLayer = (
  coach: Effect.Effect<WorkspaceRepo.CoachContext | undefined, QueryFailed>,
) =>
  Layer.succeed(
    WorkspaceRepo.Service,
    WorkspaceRepo.Service.of({
      create: Effect.fn("WorkspaceRepo.Test.create")(() => Effect.die("unused")),
      findById: Effect.fn("WorkspaceRepo.Test.findById")(() => Effect.die("unused")),
      list: Effect.fn("WorkspaceRepo.Test.list")(() => Effect.die("the entry must not list")),
      getDetail: Effect.fn("WorkspaceRepo.Test.getDetail")(() => Effect.die("unused")),
      findCoachByTelegramId: Effect.fn("WorkspaceRepo.Test.findCoachByTelegramId")(() => coach),
      rename: Effect.fn("WorkspaceRepo.Test.rename")(() => Effect.die("unused")),
    }),
  )

const testConfig = ConfigProvider.layer(ConfigProvider.fromUnknown({ MANAGER_BOT_TOKEN }))

const appLayer = (options: {
  readonly admins?: ReadonlyArray<TelegramId>
  readonly coach?: Effect.Effect<WorkspaceRepo.CoachContext | undefined, QueryFailed>
}) =>
  ViewerRole.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ManagerInitData.layer,
        adminRepoLayer(options.admins ?? []),
        workspaceRepoLayer(options.coach ?? Effect.succeed(undefined)),
        CoachOnboardingToken.testLayer("PraximoMotherBot"),
      ),
    ),
  )

const resolve = (options: Parameters<typeof appLayer>[0]) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW))
    const service = yield* ViewerRole.Service
    return yield* service.resolveRole(VALID_INIT_DATA)
  }).pipe(Effect.provide(appLayer(options)), Effect.provide(testConfig))

describe("ViewerRole", () => {
  it.effect("gives an unknown but authenticated viewer neither role", () =>
    Effect.gen(function* () {
      expect(yield* resolve({})).toEqual({ isAdmin: false, coach: null })
    }),
  )

  it.effect("resolves a pure admin without a coach context", () =>
    Effect.gen(function* () {
      expect(yield* resolve({ admins: [viewer] })).toEqual({ isAdmin: true, coach: null })
    }),
  )

  it.effect("resumes an accepted claim through its original deep link", () =>
    Effect.gen(function* () {
      expect(
        yield* resolve({
          coach: Effect.succeed({
            state: "accepted",
            workspaceId,
            code: CoachOnboardingInviteCode.make("ADA23456"),
          }),
        }),
      ).toEqual({
        isAdmin: false,
        coach: {
          state: "accepted",
          workspaceId,
          link: "https://t.me/PraximoMotherBot?start=ws_ADA23456",
        },
      })
    }),
  )

  it.effect("points a bot-connected coach at their own bot", () =>
    Effect.gen(function* () {
      expect(
        yield* resolve({
          coach: Effect.succeed({
            state: "bot-connected",
            workspaceId,
            botUsername: "ada_coach_bot",
          }),
        }),
      ).toEqual({
        isAdmin: false,
        coach: {
          state: "bot-connected",
          workspaceId,
          botUsername: "ada_coach_bot",
          link: "https://t.me/ada_coach_bot",
        },
      })
    }),
  )

  it.effect("keeps the enduring bot pointer for an active coach", () =>
    Effect.gen(function* () {
      const role = yield* resolve({
        coach: Effect.succeed({ state: "active", workspaceId, botUsername: "ada_coach_bot" }),
      })
      expect(role.coach?.state).toBe("active")
      expect(role.coach?.link).toBe("https://t.me/ada_coach_bot")
    }),
  )

  it.effect("sends a coach whose bot died to the manager, not to their own bot", () =>
    Effect.gen(function* () {
      const role = yield* resolve({
        coach: Effect.succeed({ state: "needs-relink", workspaceId, botUsername: "ada_coach_bot" }),
      })

      expect(role.coach?.state).toBe("needs-relink")
      // The whole point of the state is that `t.me/ada_coach_bot` answers
      // nothing — and a bare manager link is a dead end too, because an existing
      // chat shows no Start button for it to press (#55).
      expect(role.coach?.link).toBe("https://t.me/PraximoMotherBot?start=relink")
    }),
  )

  it.effect("reports both roles for an admin who is also a coach", () =>
    Effect.gen(function* () {
      const role = yield* resolve({
        admins: [viewer],
        coach: Effect.succeed({ state: "active", workspaceId, botUsername: "ada_coach_bot" }),
      })
      expect(role.isAdmin).toBe(true)
      expect(role.coach?.state).toBe("active")
    }),
  )

  it.effect("rejects a credential the manager bot did not sign", () =>
    Effect.gen(function* () {
      const service = yield* ViewerRole.Service
      const failure = yield* Effect.flip(service.resolveRole("auth_date=1784808000&hash=beef"))
      expect(failure._tag).toBe("ViewerRole.Unauthenticated")
    }).pipe(Effect.provide(appLayer({})), Effect.provide(testConfig)),
  )

  it.effect("fails loudly when the coach lookup itself breaks", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        resolve({
          coach: Effect.fail(new QueryFailed({ operation: "findCoach", cause: new Error("down") })),
        }),
      )
      expect(failure._tag).toBe("ViewerRole.LoadFailed")
    }),
  )
})
