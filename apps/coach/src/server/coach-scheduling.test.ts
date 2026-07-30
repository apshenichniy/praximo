import { describe, expect, it } from "@effect/vitest"
import { CoachInitData } from "@praximo/auth"
import { ClientRepo, MemberRepo, SessionRepo, WorkspaceRepo } from "@praximo/db"
import { type WorkingHours, WorkspaceId } from "@praximo/domain"
import { EmailChannel } from "@praximo/email"
import { BotRegistry } from "@praximo/telegram"
import { ConfigProvider, Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { launchFor, TEST_PUBLIC_KEY } from "@/__tests__/coach-launch.ts"
import { schedulingCopy } from "@/__tests__/scheduling-copy.ts"
import { dayView } from "@/features/coach/day-view.ts"
import { CoachClients } from "./coach-clients.ts"
import { CoachSession } from "./coach-session.ts"
import type { LaunchCredential } from "./launch-credential.ts"

const BOT_ID = "9100777"
const WORKSPACE = WorkspaceId.make("ws_ada")
const AUTH_DATE = Date.parse("2026-07-30T12:00:00.000Z")
const NOW = AUTH_DATE + 60_000
const CLIENT_APP_URL = "https://me.praximo.io"

const mondayHours: WorkingHours = {
  window: { startMinutes: 9 * 60, endMinutes: 17 * 60 },
  days: {
    mon: "window",
    tue: "off",
    wed: "window",
    thu: "window",
    fri: "window",
    sat: "off",
    sun: "off",
  },
}

const changedHours: WorkingHours = {
  window: { startMinutes: 8 * 60, endMinutes: 18 * 60 },
  days: {
    mon: { startMinutes: 10 * 60, endMinutes: 16 * 60 },
    tue: "off",
    wed: "window",
    thu: "window",
    fri: "window",
    sat: "off",
    sun: "off",
  },
}

const basePrincipal: MemberRepo.CoachPrincipalRow = {
  memberId: "mem_ada",
  workspaceId: WORKSPACE,
  language: "en",
  botUsername: "ada_coach_bot",
  telegramBotId: BOT_ID,
  botConnectionStatus: "connected",
  hasMainMiniApp: false,
  timezone: "Europe/Kyiv",
  settings: { workingHours: mondayHours },
  deletionPending: false,
  termsAcceptedAt: new Date(AUTH_DATE - 24 * 60 * 60 * 1_000),
}

const unused = () => Effect.die(new Error("unused in this suite"))

interface FixtureState {
  settings: Record<string, unknown>
  readonly busySessions: SessionRepo.BusySession[]
  readonly scheduled: SessionRepo.ScheduleInput[]
  readonly savedSettings: MemberRepo.SaveSettingsInput[]
}

const run = <A, E>(
  body: Effect.Effect<A, E, CoachClients.Service>,
  state: FixtureState = {
    settings: { workingHours: mondayHours },
    busySessions: [],
    scheduled: [],
    savedSettings: [],
  },
) => {
  const principal = (): MemberRepo.CoachPrincipalRow => ({
    ...basePrincipal,
    settings: state.settings,
  })
  const members = Layer.succeed(
    MemberRepo.Service,
    MemberRepo.Service.of({
      findCoachPrincipalByBot: Effect.fn("MemberRepo.Test.findCoachPrincipalByBot")(
        (telegramBotId) => Effect.succeed(telegramBotId === BOT_ID ? principal() : undefined),
      ),
      findCoachPrincipalByIdentity: Effect.fn("MemberRepo.Test.findCoachPrincipalByIdentity")(() =>
        Effect.succeed(principal()),
      ),
      touchLogin: Effect.fn("MemberRepo.Test.touchLogin")(() => Effect.void),
      touchActivity: Effect.fn("MemberRepo.Test.touchActivity")(() => Effect.void),
      acceptTerms: unused,
      setLanguage: unused,
      setTimezone: unused,
      saveSettings: Effect.fn("MemberRepo.Test.saveSettings")((input) => {
        state.settings = input.settings
        state.savedSettings.push(input)
        return Effect.void
      }),
    }),
  )
  const sessions = Layer.succeed(
    SessionRepo.Service,
    SessionRepo.Service.of({
      schedule: Effect.fn("SessionRepo.Test.schedule")((input) => {
        state.scheduled.push(input)
        state.busySessions.push({
          scheduledAt: input.scheduledAt,
          durationMinutes: input.durationMinutes,
        })
        return Effect.succeed({ scheduled: true } as const)
      }),
      between: Effect.fn("SessionRepo.Test.between")((_workspaceId, from, to) =>
        Effect.succeed(
          state.busySessions.filter(
            (booking) => booking.scheduledAt >= from && booking.scheduledAt < to,
          ),
        ),
      ),
      scheduled: unused,
      find: unused,
    }),
  )
  const clients = Layer.succeed(
    ClientRepo.Service,
    ClientRepo.Service.of({
      createWithInvite: unused,
      list: unused,
      find: unused,
      deleteUnaccepted: unused,
      reissueInvite: unused,
      recordDelivery: unused,
    }),
  )
  const workspaces = Layer.succeed(
    WorkspaceRepo.Service,
    WorkspaceRepo.Service.of({
      findById: unused,
      create: unused,
      list: unused,
      getDetail: unused,
      findCoachByTelegramId: unused,
      rename: unused,
    }),
  )
  const dependencies = Layer.mergeAll(
    members,
    sessions,
    clients,
    workspaces,
    BotRegistry.testLayer,
    EmailChannel.testLayer,
    CoachSession.layer.pipe(
      Layer.provide(Layer.mergeAll(CoachInitData.testLayer(TEST_PUBLIC_KEY), members)),
    ),
    ConfigProvider.layer(ConfigProvider.fromUnknown({ CLIENT_APP_URL })),
  )

  return body.pipe(Effect.provide(CoachClients.layer.pipe(Layer.provide(dependencies))))
}

const credential = async (): Promise<LaunchCredential> => ({
  initData: await launchFor({ botId: BOT_ID, authDate: AUTH_DATE }),
  botId: BOT_ID,
})

describe("CoachClients scheduling", () => {
  it.effect("reads and saves the whole working week through the service", () =>
    run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachClients.Service
        const launch = yield* Effect.promise(() => credential())

        expect(yield* service.workingHours(launch)).toEqual(mondayHours)
        expect(yield* service.saveWorkingHours(launch, changedHours)).toEqual({ saved: true })
        expect(yield* service.workingHours(launch)).toEqual(changedHours)
      }),
    ),
  )

  it.effect("round trips working hours and a booking into the day view", () => {
    const state: FixtureState = {
      settings: { workingHours: mondayHours },
      busySessions: [],
      scheduled: [],
      savedSettings: [],
    }
    return run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachClients.Service
        const launch = yield* Effect.promise(() => credential())

        expect(
          yield* service.schedule(launch, {
            clientId: "cl_anna",
            date: "2026-08-03",
            startMinutes: 10 * 60,
            durationMinutes: 60,
            kind: "regular",
          }),
        ).toEqual({ scheduled: true })

        expect(state.scheduled[0]).toMatchObject({
          workspaceId: WORKSPACE,
          clientId: "cl_anna",
          scheduledAt: new Date("2026-08-03T07:00:00.000Z"),
          durationMinutes: 60,
          kind: "regular",
          now: new Date(NOW),
        })

        const schedule = yield* service.daySchedule(launch, "2026-08-03")
        expect(schedule).toEqual({
          busy: [{ startMinutes: 600, endMinutes: 660 }],
          working: mondayHours.window,
          timezone: "Europe/Kyiv",
        })

        const view = dayView({
          schedule,
          durationMinutes: 60,
          date: new Date(2026, 7, 3),
          startMinutes: undefined,
          language: "en",
          copy: schedulingCopy,
        })
        const morning = view.groups.find((group) => group.part === "morning")
        expect(morning?.slots.find((slot) => slot.startMinutes === 600)?.available).toBe(false)
        expect(morning?.slots.find((slot) => slot.startMinutes === 660)?.available).toBe(true)
      }),
      state,
    )
  })

  it.effect("reads consecutive days in one range with each day's working policy", () => {
    const state: FixtureState = {
      settings: { workingHours: mondayHours },
      busySessions: [{ scheduledAt: new Date("2026-08-03T07:00:00.000Z"), durationMinutes: 60 }],
      scheduled: [],
      savedSettings: [],
    }
    return run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachClients.Service
        const result = yield* service.rangeSchedule(
          yield* Effect.promise(() => credential()),
          "2026-08-03",
          2,
        )

        expect(result).toEqual([
          {
            date: "2026-08-03",
            busy: [{ startMinutes: 600, endMinutes: 660 }],
            working: mondayHours.window,
            timezone: "Europe/Kyiv",
          },
          {
            date: "2026-08-04",
            busy: [],
            timezone: "Europe/Kyiv",
          },
        ])
      }),
      state,
    )
  })
})
