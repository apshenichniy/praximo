import { describe, expect, it } from "@effect/vitest"
import { CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import {
  AdminRepo,
  CoachOnboardingRepo,
  QueryFailed,
  WorkspaceDeletionRepo,
  WorkspaceRepo,
} from "@praximo/db"
import {
  Admin,
  AdminId,
  AdminNotFound,
  CoachLanguage,
  CoachOnboardingInviteCode,
  CoachOnboardingInviteId,
  TelegramId,
  WorkspaceId,
  WorkspaceNotFound,
} from "@praximo/domain"
import { ConfigProvider, Effect, Layer } from "effect"
import { CoachBotBranding, CoachBotRelease, ManagerBotSender } from "@praximo/telegram"
import * as TestClock from "effect/testing/TestClock"
import { AdminSurface } from "./admin-surface.ts"
import { WorkspaceBrandingStorage } from "./workspace-branding-storage.ts"
import { WorkspaceRunCancellation } from "./workspace-run-cancellation.ts"

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

const NOW = "2026-07-23T12:01:00.000Z"
const hoursBefore = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000)
const hoursAfter = (hours: number) => new Date(Date.parse(NOW) + hours * 3_600_000)

let inviteSequence = 0
/** A list-shaped invite with only the fields a given stage actually needs. */
const listInvite = (overrides: Partial<WorkspaceRepo.ListInvite>): WorkspaceRepo.ListInvite => {
  inviteSequence += 1
  return WorkspaceRepo.ListInvite.make({
    id: CoachOnboardingInviteId.make(`ci_row_${inviteSequence}`),
    code: CoachOnboardingInviteCode.make("ADA23456"),
    status: "pending",
    issuedAt: hoursBefore(1),
    expiresAt: hoursAfter(6 * 24),
    ...overrides,
  })
}

const activeRow = WorkspaceRepo.ListItem.make({
  id: WorkspaceId.make("ws_ada"),
  name: "Ada Coaching",
  botStatus: "connected",
  botUsername: "ada_coach_bot",
  hasCustomAvatar: false,
  ownerTelegramUserId: "700000001",
  termsAcceptedAt: hoursBefore(200),
  lastActivityAt: hoursBefore(2),
})

const workspaceRows = [activeRow]

/** One row per onboarding stage the coaches list can render. */
const stageRows: ReadonlyArray<WorkspaceRepo.ListItem> = [
  activeRow,
  WorkspaceRepo.ListItem.make({
    id: WorkspaceId.make("ws_invited"),
    name: "Invited",
    botStatus: "awaiting-setup",
    hasCustomAvatar: false,
    invite: listInvite({ delivery: { channel: "telegram", language: "en" } }),
  }),
  WorkspaceRepo.ListItem.make({
    id: WorkspaceId.make("ws_accepted"),
    name: "Accepted",
    botStatus: "awaiting-setup",
    hasCustomAvatar: false,
    invite: listInvite({
      status: "accepted",
      acceptedAt: hoursBefore(2),
      acceptedByTelegramId: "800000001",
    }),
  }),
  WorkspaceRepo.ListItem.make({
    id: WorkspaceId.make("ws_stalled"),
    name: "Stalled",
    botStatus: "awaiting-setup",
    hasCustomAvatar: false,
    invite: listInvite({
      status: "accepted",
      acceptedAt: hoursBefore(48),
      acceptedByTelegramId: "800000002",
    }),
  }),
  WorkspaceRepo.ListItem.make({
    id: WorkspaceId.make("ws_bot_connected"),
    name: "Bot connected",
    botStatus: "connected",
    botUsername: "connected_bot",
    hasCustomAvatar: false,
    ownerTelegramUserId: "800000003",
    invite: listInvite({ status: "used" }),
  }),
  WorkspaceRepo.ListItem.make({
    id: WorkspaceId.make("ws_expired"),
    name: "Expired",
    botStatus: "awaiting-setup",
    hasCustomAvatar: false,
    // Still `pending` in the row: expiry is lazy, so the surface derives it.
    invite: listInvite({ issuedAt: hoursBefore(8 * 24), expiresAt: hoursBefore(24) }),
  }),
  WorkspaceRepo.ListItem.make({
    id: WorkspaceId.make("ws_declined"),
    name: "Declined",
    botStatus: "awaiting-setup",
    hasCustomAvatar: false,
    invite: listInvite({
      status: "cancelled",
      cancelledAt: hoursBefore(30),
      cancellationReason: "declined_by_coach",
    }),
  }),
  WorkspaceRepo.ListItem.make({
    id: WorkspaceId.make("ws_reset"),
    name: "Reset",
    botStatus: "awaiting-setup",
    hasCustomAvatar: false,
    invite: listInvite({
      status: "cancelled",
      cancelledAt: hoursBefore(30),
      cancellationReason: "reset_by_admin",
    }),
  }),
  WorkspaceRepo.ListItem.make({
    id: WorkspaceId.make("ws_bare"),
    name: "Never invited",
    botStatus: "awaiting-setup",
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
    code: CoachOnboardingInviteCode.make("ADA23456"),
    workspaceId: WorkspaceId.make("ws_cb6bd55960914d69aeff2af000354c7f"),
    status: "pending",
    issuedAt: new Date("2026-07-23T12:01:00.000Z"),
    expiresAt: new Date("2026-07-30T12:01:00.000Z"),
    issuedByTelegramId: "100000001",
  },
}

const detailWorkspace: WorkspaceRepo.Detail = {
  id: createdAggregate.workspace.id,
  name: "Ada Coaching",
  description: "Initial description",
  createdAt: new Date("2026-07-23T12:00:00.000Z"),
  updatedAt: new Date("2026-07-23T12:01:00.000Z"),
  coachLanguage: CoachLanguage.make("uk"),
  botStatus: "connected",
  botUsername: "ada_coach_bot",
  invite: createdAggregate.invite,
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
      getDetail: Effect.fn("WorkspaceRepo.Test.getDetail")(() => Effect.die("unused")),
      updateProfile: Effect.fn("WorkspaceRepo.Test.updateProfile")(() => Effect.die("unused")),
    }),
  )

const testConfig = ConfigProvider.layer(ConfigProvider.fromUnknown({ MANAGER_BOT_TOKEN }))

interface RecordedDelivery {
  readonly id: string
  readonly delivery: unknown
}

/**
 * A configurable onboarding repo double: `outcome` drives createOrGet, and
 * every recordDelivery lands in the caller's `recorded` array.
 */
const onboardingRepoDouble = (options: {
  readonly outcome?: Effect.Effect<
    CoachOnboardingRepo.CreateOutcome,
    CoachOnboardingRepo.IdempotencyConflict | QueryFailed
  >
  readonly recorded?: Array<RecordedDelivery>
  readonly aggregate?: CoachOnboardingRepo.Aggregate
}) =>
  Layer.succeed(
    CoachOnboardingRepo.Service,
    CoachOnboardingRepo.Service.of({
      lookupCreate: Effect.fn("CoachOnboardingRepo.Test.lookupCreate")(() =>
        Effect.die("the surface must not preflight"),
      ),
      createOrGet: Effect.fn("CoachOnboardingRepo.Test.createOrGet")(
        () => options.outcome ?? Effect.die("unused in these tests"),
      ),
      resolveCode: Effect.fn("CoachOnboardingRepo.Test.resolveCode")(() =>
        Effect.die("resolveCode is bot-only and unused in these tests"),
      ),
      findInvite: Effect.fn("CoachOnboardingRepo.Test.findInvite")(() =>
        Effect.succeed(options.aggregate ?? createdAggregate),
      ),
      verifyPending: Effect.fn("CoachOnboardingRepo.Test.verifyPending")(() =>
        Effect.succeed(options.aggregate ?? createdAggregate),
      ),
      markUsed: Effect.fn("CoachOnboardingRepo.Test.markUsed")(() =>
        Effect.succeed((options.aggregate ?? createdAggregate).invite),
      ),
      recordDelivery: Effect.fn("CoachOnboardingRepo.Test.recordDelivery")((id, delivery) => {
        options.recorded?.push({ id, delivery })
        return Effect.void
      }),
      reissue: Effect.fn("CoachOnboardingRepo.Test.reissue")(() =>
        Effect.succeed(options.aggregate ?? createdAggregate),
      ),
    }),
  )

const onboardingRepoLayer = onboardingRepoDouble({})

const successfulOnboardingRepoLayer = onboardingRepoDouble({
  outcome: Effect.succeed({ aggregate: createdAggregate, created: true }),
})

const unusedDeletionRepoLayer = Layer.succeed(
  WorkspaceDeletionRepo.Service,
  WorkspaceDeletionRepo.Service.of({
    prepare: Effect.fn("WorkspaceDeletionRepo.Test.prepare")(() => Effect.die("unused")),
    markPipeline: Effect.fn("WorkspaceDeletionRepo.Test.markPipeline")(() => Effect.die("unused")),
    markFarewell: Effect.fn("WorkspaceDeletionRepo.Test.markFarewell")(() => Effect.die("unused")),
    markBotReleased: Effect.fn("WorkspaceDeletionRepo.Test.markBotReleased")(() =>
      Effect.die("unused"),
    ),
    finalize: Effect.fn("WorkspaceDeletionRepo.Test.finalize")(() => Effect.die("unused")),
    isDeleting: Effect.fn("WorkspaceDeletionRepo.Test.isDeleting")(() => Effect.succeed(false)),
    purgeExpired: Effect.fn("WorkspaceDeletionRepo.Test.purgeExpired")(() => Effect.succeed(0)),
    reconcileOrphans: Effect.fn("WorkspaceDeletionRepo.Test.reconcileOrphans")(() =>
      Effect.succeed(0),
    ),
  }),
)

const deletionDependencies = Layer.mergeAll(
  unusedDeletionRepoLayer,
  WorkspaceRunCancellation.layer,
  CoachBotRelease.layer,
)

const createDependencies = Layer.mergeAll(
  onboardingRepoLayer,
  CoachOnboardingToken.testLayer("PraximoMotherBot"),
  WorkspaceBrandingStorage.testLayer({
    defaultAvatarKey: "branding/default-coach-avatar.jpg",
  }),
  ManagerBotSender.testLayer,
  CoachBotBranding.testLayer,
  deletionDependencies,
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

const createLayerWith = (onboardingLayer: Layer.Layer<CoachOnboardingRepo.Service>) =>
  Layer.provideMerge(
    AdminSurface.layer,
    Layer.mergeAll(
      ManagerInitData.layer,
      adminRepoLayer,
      workspaceRepoLayer([]),
      onboardingLayer,
      CoachOnboardingToken.testLayer("PraximoMotherBot"),
      WorkspaceBrandingStorage.testLayer({
        defaultAvatarKey: "branding/default-coach-avatar.jpg",
      }),
      ManagerBotSender.testLayer,
      CoachBotBranding.testLayer,
      deletionDependencies,
    ),
  )

const profileWorkspaceRepoLayer = Layer.succeed(
  WorkspaceRepo.Service,
  WorkspaceRepo.Service.of({
    create: Effect.fn("WorkspaceRepo.Test.create")((workspace) => Effect.succeed(workspace)),
    findById: Effect.fn("WorkspaceRepo.Test.findById")(() =>
      Effect.succeed({
        id: detailWorkspace.id,
        name: detailWorkspace.name,
      }),
    ),
    list: Effect.fn("WorkspaceRepo.Test.list")(() => Effect.succeed([])),
    getDetail: Effect.fn("WorkspaceRepo.Test.getDetail")(() => Effect.succeed(detailWorkspace)),
    updateProfile: Effect.fn("WorkspaceRepo.Test.updateProfile")((input) => {
      const {
        description: _description,
        shortDescription: _shortDescription,
        avatarR2Key: _avatarR2Key,
        ...base
      } = detailWorkspace
      return Effect.succeed({
        ...base,
        name: input.name,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.shortDescription === undefined
          ? {}
          : { shortDescription: input.shortDescription }),
        ...(input.avatarR2Key === undefined ? {} : { avatarR2Key: input.avatarR2Key }),
        updatedAt: input.now,
      })
    }),
  }),
)

const profileAppLayer = Layer.provideMerge(
  AdminSurface.layer,
  Layer.mergeAll(
    ManagerInitData.layer,
    adminRepoLayer,
    profileWorkspaceRepoLayer,
    successfulOnboardingRepoLayer,
    CoachOnboardingToken.testLayer("PraximoMotherBot"),
    WorkspaceBrandingStorage.testLayer({
      defaultAvatarKey: "branding/default-coach-avatar.jpg",
    }),
    ManagerBotSender.testLayer,
    CoachBotBranding.testLayer,
    deletionDependencies,
  ),
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

      expect(yield* adminSurface.listWorkspaces(VALID_INIT_DATA)).toEqual({
        coaches: [
          {
            id: activeRow.id,
            name: "Ada Coaching",
            botStatus: "connected",
            botUsername: "ada_coach_bot",
            lastActivityAt: hoursBefore(2).toISOString(),
          },
        ],
      })
    }).pipe(Effect.provide(appLayer(workspaceRows)), Effect.provide(testConfig)),
  )

  it.effect("returns an empty list to a verified admin when no workspaces exist", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service

      expect(yield* adminSurface.listWorkspaces(VALID_INIT_DATA)).toEqual({ coaches: [] })
    }).pipe(Effect.provide(appLayer([])), Effect.provide(testConfig)),
  )

  it.effect("pins incomplete onboarding above active coaches, newest invite first", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW))
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.listWorkspaces(VALID_INIT_DATA)

      expect(result.coaches.map((coach) => coach.id)).toEqual([
        "ws_fresh",
        "ws_older",
        "ws_ada",
        "ws_zoe",
      ])
    }).pipe(
      Effect.provide(
        appLayer([
          // Deliberately supplied in the repo's A→Z order.
          activeRow,
          WorkspaceRepo.ListItem.make({
            id: WorkspaceId.make("ws_fresh"),
            name: "Fresh invite",
            botStatus: "awaiting-setup",
            hasCustomAvatar: false,
            invite: listInvite({ issuedAt: hoursBefore(1) }),
          }),
          WorkspaceRepo.ListItem.make({
            id: WorkspaceId.make("ws_older"),
            name: "Older invite",
            botStatus: "awaiting-setup",
            hasCustomAvatar: false,
            invite: listInvite({ issuedAt: hoursBefore(50) }),
          }),
          WorkspaceRepo.ListItem.make({
            id: WorkspaceId.make("ws_zoe"),
            name: "Zoe Coaching",
            botStatus: "connected",
            botUsername: "zoe_bot",
            hasCustomAvatar: false,
            termsAcceptedAt: hoursBefore(500),
          }),
        ]),
      ),
      Effect.provide(testConfig),
    ),
  )

  it.effect("reads each onboarding stage off the aggregate", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW))
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.listWorkspaces(VALID_INIT_DATA)
      const stages = Object.fromEntries(
        result.coaches.map((coach) => [coach.id, coach.onboarding?.stage]),
      )

      expect(stages).toEqual({
        ws_invited: "invited",
        ws_accepted: "accepted",
        ws_stalled: "stalled",
        ws_bot_connected: "bot-connected",
        ws_expired: "expired",
        ws_declined: "declined",
        ws_reset: "reset",
        ws_bare: "not-invited",
        // Terms acceptance is the completion signal: no stage at all.
        ws_ada: undefined,
      })
    }).pipe(Effect.provide(appLayer(stageRows)), Effect.provide(testConfig)),
  )

  it.effect("counts down only while the invite is pending, and offers resend there only", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW))
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.listWorkspaces(VALID_INIT_DATA)
      const byId: Record<string, AdminSurface.CoachOnboarding | undefined> = Object.fromEntries(
        result.coaches.map((coach) => [coach.id, coach.onboarding]),
      )

      expect(byId.ws_invited).toMatchObject({
        channel: "telegram",
        expiresAt: hoursAfter(6 * 24).toISOString(),
      })
      expect(byId.ws_invited?.actions?.link).toContain("?start=ws_ADA23456")
      // An accepted claim keeps its acceptance time but never an expiry, and it
      // is past the point where resending the old link would mean anything.
      expect(byId.ws_accepted?.acceptedAt).toBe(hoursBefore(2).toISOString())
      expect(byId.ws_accepted).not.toHaveProperty("expiresAt")
      expect(byId.ws_accepted?.actions).toBeUndefined()
      expect(byId.ws_expired?.actions).toBeUndefined()
      expect(byId.ws_stalled?.actions).toBeUndefined()
    }).pipe(Effect.provide(appLayer(stageRows)), Effect.provide(testConfig)),
  )

  it.effect("surfaces the viewing admin's own coach claim without a second query", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW))
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.listWorkspaces(VALID_INIT_DATA)

      expect(result.viewerCoach).toEqual({
        state: "accepted",
        workspaceId: "ws_mine",
        link: "https://t.me/PraximoMotherBot?start=ws_ADA23456",
      })
    }).pipe(
      Effect.provide(
        appLayer([
          activeRow,
          WorkspaceRepo.ListItem.make({
            id: WorkspaceId.make("ws_mine"),
            name: "My practice",
            botStatus: "awaiting-setup",
            hasCustomAvatar: false,
            invite: listInvite({
              status: "accepted",
              acceptedAt: hoursBefore(3),
              acceptedByTelegramId: adminTelegramId,
            }),
          }),
        ]),
      ),
      Effect.provide(testConfig),
    ),
  )

  it.effect("prefers the admin's active bot over an older claim", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW))
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.listWorkspaces(VALID_INIT_DATA)

      expect(result.viewerCoach).toEqual({
        state: "active",
        workspaceId: "ws_my_bot",
        link: "https://t.me/my_own_bot",
      })
    }).pipe(
      Effect.provide(
        appLayer([
          WorkspaceRepo.ListItem.make({
            id: WorkspaceId.make("ws_claimed"),
            name: "Claimed",
            botStatus: "awaiting-setup",
            hasCustomAvatar: false,
            invite: listInvite({
              status: "accepted",
              acceptedAt: hoursBefore(3),
              acceptedByTelegramId: adminTelegramId,
            }),
          }),
          WorkspaceRepo.ListItem.make({
            id: WorkspaceId.make("ws_my_bot"),
            name: "My bot",
            botStatus: "connected",
            botUsername: "my_own_bot",
            hasCustomAvatar: false,
            ownerTelegramUserId: adminTelegramId,
            termsAcceptedAt: hoursBefore(100),
          }),
        ]),
      ),
      Effect.provide(testConfig),
    ),
  )

  it.effect("leaves the viewer's coach context absent when they are only an admin", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW))
      const adminSurface = yield* AdminSurface.Service

      expect(yield* adminSurface.listWorkspaces(VALID_INIT_DATA)).not.toHaveProperty("viewerCoach")
    }).pipe(Effect.provide(appLayer(stageRows)), Effect.provide(testConfig)),
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

  it.effect("telegram action: creates the invite only — the share is a follow-up step", () => {
    const recorded: Array<RecordedDelivery> = []
    return Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.createWorkspace(
        VALID_INIT_DATA,
        {
          requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
          name: "  Ada Coaching  ",
        },
        { channel: "telegram", language: "uk" },
      )
      const sender = yield* ManagerBotSender.TestService

      expect(result).toMatchObject({
        workspaceId: "ws_cb6bd55960914d69aeff2af000354c7f",
        // Nothing is delivered on create: the manager shares from the Mini App
        // in a follow-up prepare step, and the picker can still be cancelled.
        delivery: "unknown",
      })
      expect(result.link).toContain("https://t.me/PraximoMotherBot?start=ws_")
      expect(result.message).toContain("Ваш простір Praximo")
      expect(result.message).toContain(result.link)
      // No send to the manager's own chat, and nothing prepared or recorded yet.
      expect(yield* sender.sent()).toEqual([])
      expect(yield* sender.prepared()).toEqual([])
      expect(recorded).toEqual([])
    }).pipe(
      Effect.provide(
        createLayerWith(
          onboardingRepoDouble({
            outcome: Effect.succeed({ aggregate: createdAggregate, created: true }),
            recorded,
          }),
        ),
      ),
      Effect.provide(testConfig),
    )
  })

  it.effect("copy action: records the delivery and returns the message without sending", () => {
    const recorded: Array<RecordedDelivery> = []
    return Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.createWorkspace(
        VALID_INIT_DATA,
        { requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f" },
        { channel: "copy", language: "en" },
      )
      const sender = yield* ManagerBotSender.TestService

      // Unnamed invite: the generic message variant, no «name» placeholder.
      expect(result.message).toContain("Your Praximo workspace is ready.")
      expect(result.message).toContain(result.link)
      expect(yield* sender.sent()).toEqual([])
      expect(recorded).toEqual([
        {
          id: createdAggregate.invite.id,
          delivery: { channel: "copy", language: "en" },
        },
      ])
    }).pipe(
      Effect.provide(
        createLayerWith(
          onboardingRepoDouble({
            outcome: Effect.succeed({
              aggregate: {
                ...createdAggregate,
                workspace: { ...createdAggregate.workspace, name: "" },
              },
              created: true,
            }),
            recorded,
          }),
        ),
      ),
      Effect.provide(testConfig),
    )
  })

  it.effect(
    "retry of an action replays the aggregate and delivers again, never duplicating",
    () => {
      const recorded: Array<RecordedDelivery> = []
      return Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
        const adminSurface = yield* AdminSurface.Service
        const result = yield* adminSurface.createWorkspace(
          VALID_INIT_DATA,
          { requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f", name: "Ada Coaching" },
          { channel: "copy", language: "ru" },
        )

        expect(result.message).toContain("Ваше пространство Praximo «Ada Coaching» готово.")
        expect(recorded).toHaveLength(1)
      }).pipe(
        Effect.provide(
          createLayerWith(
            onboardingRepoDouble({
              // The repo reports a replay: same requestId, nothing new created.
              outcome: Effect.succeed({ aggregate: createdAggregate, created: false }),
              recorded,
            }),
          ),
        ),
        Effect.provide(testConfig),
      )
    },
  )

  it.effect("prepare share: prepares the bot-authored invite without recording delivery", () => {
    const recorded: Array<RecordedDelivery> = []
    return Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.prepareInviteShareMessage(
        VALID_INIT_DATA,
        createdAggregate.invite.id,
        "uk",
      )
      const sender = yield* ManagerBotSender.TestService

      expect(result.preparedMessageId).toBe("prepared-message-0")
      const prepared = yield* sender.prepared()
      expect(prepared).toEqual([
        {
          recipient: adminTelegramId,
          invite: {
            title: expect.any(String),
            text: expect.stringContaining("Ваш простір Praximo «Ada Coaching»"),
            buttonText: "Почати налаштування",
            buttonUrl: "https://t.me/PraximoMotherBot?start=ws_ADA23456",
          },
        },
      ])
      // The prepared text carries the deep link so the button has a plain-text peer.
      expect(prepared[0]?.invite.text).toContain("https://t.me/PraximoMotherBot?start=ws_ADA23456")
      // Preparing does not record delivery: the picker can still be cancelled, so
      // the record waits for the client to confirm the share (recordInviteShare).
      expect(recorded).toEqual([])
    }).pipe(
      Effect.provide(createLayerWith(onboardingRepoDouble({ recorded }))),
      Effect.provide(testConfig),
    )
  })

  it.effect("record share: records the telegram delivery once the client confirms it", () => {
    const recorded: Array<RecordedDelivery> = []
    return Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      yield* adminSurface.recordInviteShare(VALID_INIT_DATA, createdAggregate.invite.id, "uk")

      // Coach is unknown until they claim the invite, so destination is omitted.
      expect(recorded).toEqual([
        {
          id: createdAggregate.invite.id,
          delivery: { channel: "telegram", language: "uk" },
        },
      ])
    }).pipe(
      Effect.provide(createLayerWith(onboardingRepoDouble({ recorded }))),
      Effect.provide(testConfig),
    )
  })

  it.effect("record share: rejects a non-admin caller", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const error = yield* Effect.flip(
        adminSurface.recordInviteShare(VALID_INIT_DATA, createdAggregate.invite.id, "en"),
      )

      expect(error._tag).toBe("AdminSurface.AccessDenied")
    }).pipe(Effect.provide(nonAdminLayer)),
  )

  it.effect(
    "prepare share: a failed prepare surfaces a retryable error and records nothing",
    () => {
      const recorded: Array<RecordedDelivery> = []
      return Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
        const sender = yield* ManagerBotSender.TestService
        yield* sender.failNextPrepare(
          new ManagerBotSender.PrepareFailed({ recipient: adminTelegramId, category: "bot-api" }),
        )
        const adminSurface = yield* AdminSurface.Service
        const error = yield* Effect.flip(
          adminSurface.prepareInviteShareMessage(VALID_INIT_DATA, createdAggregate.invite.id, "uk"),
        )

        expect(error._tag).toBe("AdminSurface.SharePreparationFailed")
        expect(recorded).toEqual([])
      }).pipe(
        Effect.provide(createLayerWith(onboardingRepoDouble({ recorded }))),
        Effect.provide(testConfig),
      )
    },
  )

  it.effect("prepare share: rejects a non-admin caller", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const error = yield* Effect.flip(
        adminSurface.prepareInviteShareMessage(VALID_INIT_DATA, createdAggregate.invite.id, "en"),
      )

      expect(error._tag).toBe("AdminSurface.AccessDenied")
    }).pipe(Effect.provide(nonAdminLayer)),
  )

  it.effect("rejects an unshippable delivery channel and surfaces an idempotency conflict", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const invalid = yield* Effect.flip(
        adminSurface.createWorkspace(
          VALID_INIT_DATA,
          { requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f" },
          { channel: "email", language: "en" },
        ),
      )
      expect(invalid._tag).toBe("AdminSurface.ValidationFailed")
    }).pipe(
      Effect.provide(
        createLayerWith(
          onboardingRepoDouble({
            outcome: Effect.fail(
              new CoachOnboardingRepo.IdempotencyConflict({
                requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
              }),
            ),
          }),
        ),
      ),
      Effect.provide(testConfig),
    ),
  )

  it.effect("maps a conflicting request id to IdempotencyConflict", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const conflict = yield* Effect.flip(
        adminSurface.createWorkspace(
          VALID_INIT_DATA,
          { requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f", name: "Different" },
          { channel: "copy", language: "en" },
        ),
      )
      expect(conflict._tag).toBe("AdminSurface.IdempotencyConflict")
    }).pipe(
      Effect.provide(
        createLayerWith(
          onboardingRepoDouble({
            outcome: Effect.fail(
              new CoachOnboardingRepo.IdempotencyConflict({
                requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
              }),
            ),
          }),
        ),
      ),
      Effect.provide(testConfig),
    ),
  )

  it.effect("loads a complete workspace detail without exposing its private avatar key", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:02:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const detail = yield* adminSurface.getWorkspace(VALID_INIT_DATA, detailWorkspace.id)

      expect(detail).toMatchObject({
        id: detailWorkspace.id,
        name: "Ada Coaching",
        description: "Initial description",
        coachLanguage: "uk",
        botStatus: "connected",
        botUsername: "ada_coach_bot",
        canReissue: false,
      })
      expect(detail).not.toHaveProperty("avatarR2Key")
      expect(detail.invite).not.toHaveProperty("link")
    }).pipe(Effect.provide(profileAppLayer), Effect.provide(testConfig)),
  )

  it.effect("saves the workspace profile and applies connected-bot branding without its name", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:02:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.updateWorkspaceProfile(
        VALID_INIT_DATA,
        detailWorkspace.id,
        {
          requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
          expectedUpdatedAt: "2026-07-23T12:01:00.000Z",
          name: "  Renamed Workspace  ",
          description: "   ",
          shortDescription: "  Short  ",
          avatarIntent: "keep",
        },
      )
      const branding = yield* CoachBotBranding.TestService

      expect(result).toMatchObject({
        status: "saved",
        retryAvatar: false,
        workspace: {
          name: "Renamed Workspace",
          shortDescription: "Short",
        },
      })
      expect(result.workspace).not.toHaveProperty("description")
      expect(yield* branding.applied()).toEqual([
        {
          workspaceId: detailWorkspace.id,
          shortDescription: "Short",
          avatar: { _tag: "Keep" },
        },
      ])
      expect((yield* branding.applied())[0]).not.toHaveProperty("name")
    }).pipe(Effect.provide(profileAppLayer), Effect.provide(testConfig)),
  )

  it.effect("keeps a committed profile visible when Telegram branding fails", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:02:00.000Z"))
      const branding = yield* CoachBotBranding.TestService
      yield* branding.failNextApply()
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.updateWorkspaceProfile(
        VALID_INIT_DATA,
        detailWorkspace.id,
        {
          requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
          expectedUpdatedAt: "2026-07-23T12:01:00.000Z",
          name: "Persisted despite Telegram",
          avatarIntent: "keep",
        },
      )

      expect(result.status).toBe("saved-branding-failed")
      expect(result.workspace.name).toBe("Persisted despite Telegram")
    }).pipe(Effect.provide(profileAppLayer), Effect.provide(testConfig)),
  )

  it.effect("reissues, reconstructs, and delivers a fresh onboarding link after commit", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:02:00.000Z"))
      const adminSurface = yield* AdminSurface.Service
      const result = yield* adminSurface.reissueWorkspaceInvite(
        VALID_INIT_DATA,
        createdAggregate.workspace.id,
        createdAggregate.invite.id,
        "cb6bd559-6091-4d69-aeff-2af000354c7f",
      )
      const sender = yield* ManagerBotSender.TestService

      expect(result.delivery).toBe("sent")
      expect(result.link).toContain("https://t.me/PraximoMotherBot?start=ws_")
      expect(yield* sender.sent()).toHaveLength(1)
    }).pipe(Effect.provide(profileAppLayer), Effect.provide(testConfig)),
  )
})
