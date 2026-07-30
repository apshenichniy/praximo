import { describe, expect, it } from "@effect/vitest"
import { CoachInitData } from "@praximo/auth"
import { ClientRepo, MemberRepo, SessionRepo, WorkspaceRepo } from "@praximo/db"
import { WorkspaceId } from "@praximo/domain"
import { BotRegistry } from "@praximo/telegram"
import { Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { launchFor, TEST_PUBLIC_KEY } from "@/__tests__/coach-launch.ts"
import { CoachSession } from "./coach-session.ts"
import { CoachSessions } from "./coach-sessions.ts"
import type { LaunchCredential } from "@/launch-credential.ts"

/**
 * The two lifecycle writes a coach makes (#62), through the service rather than
 * through the database.
 *
 * What this suite owns and the repository suite cannot: the *auth window* — a
 * write accepts a fifteen-minute-old launch and a read a day-old one (ADR 0006)
 * — the mapping of a draft's own refusals onto the screen's four words, and the
 * fact that the workspace comes from the launch rather than from the request.
 */

const BOT_ID = "9100777"
const WORKSPACE = WorkspaceId.make("ws_ada")
const NOW = Date.parse("2026-07-27T06:00:00.000Z")
const FRESH = NOW - 60_000
/** Older than the fifteen minutes a write accepts, younger than a read's day. */
const STALE = NOW - 20 * 60_000

const basePrincipal: MemberRepo.CoachPrincipalRow = {
  memberId: "mem_ada",
  workspaceId: WORKSPACE,
  language: "en",
  botUsername: "ada_coach_bot",
  telegramBotId: BOT_ID,
  botConnectionStatus: "connected",
  hasMainMiniApp: false,
  timezone: "Europe/Kyiv",
  settings: {},
  deletionPending: false,
  termsAcceptedAt: new Date(NOW - 24 * 60 * 60 * 1_000),
}

const unused = () => Effect.die(new Error("unused in this suite"))

interface FixtureState {
  readonly moves: SessionRepo.RescheduleInput[]
  readonly cancels: Array<{ workspaceId: string; sessionId: string; now: Date }>
  /** What the repository answers, so the service's mapping is the subject. */
  moveOutcome: SessionRepo.RescheduleOutcome
  cancelled: boolean
  found: SessionRepo.ScheduledSessionRow | undefined
}

const emptyState = (): FixtureState => ({
  moves: [],
  cancels: [],
  moveOutcome: { rescheduled: true },
  cancelled: true,
  found: undefined,
})

const run = <A, E>(body: Effect.Effect<A, E, CoachSessions.Service>, state = emptyState()) => {
  const members = Layer.succeed(
    MemberRepo.Service,
    MemberRepo.Service.of({
      findCoachPrincipalByBot: Effect.fn("MemberRepo.Test.findCoachPrincipalByBot")(
        (telegramBotId) => Effect.succeed(telegramBotId === BOT_ID ? basePrincipal : undefined),
      ),
      findCoachPrincipalByIdentity: Effect.fn("MemberRepo.Test.findCoachPrincipalByIdentity")(() =>
        Effect.succeed(undefined),
      ),
      // Both are bookkeeping the principal read performs on every launch.
      touchActivity: Effect.fn("MemberRepo.Test.touchActivity")(() => Effect.void),
      touchLogin: Effect.fn("MemberRepo.Test.touchLogin")(() => Effect.void),
      acceptTerms: unused,
      setLanguage: unused,
      setTimezone: unused,
      saveSettings: unused,
    }),
  )
  const sessions = Layer.succeed(
    SessionRepo.Service,
    SessionRepo.Service.of({
      schedule: unused,
      between: unused,
      scheduled: unused,
      find: Effect.fn("SessionRepo.Test.find")(() => Effect.succeed(state.found)),
      reschedule: Effect.fn("SessionRepo.Test.reschedule")((input) => {
        state.moves.push(input)
        return Effect.succeed(state.moveOutcome)
      }),
      cancel: Effect.fn("SessionRepo.Test.cancel")((workspaceId, sessionId, now) => {
        state.cancels.push({ workspaceId, sessionId, now })
        return Effect.succeed({ cancelled: state.cancelled })
      }),
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

  return body.pipe(
    Effect.provide(
      CoachSessions.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            members,
            sessions,
            clients,
            workspaces,
            BotRegistry.testLayer,
            CoachSession.layer.pipe(
              Layer.provide(Layer.mergeAll(CoachInitData.testLayer(TEST_PUBLIC_KEY), members)),
            ),
          ),
        ),
      ),
    ),
  )
}

const credential = async (authDate = FRESH): Promise<LaunchCredential> => ({
  initData: await launchFor({ botId: BOT_ID, authDate }),
  botId: BOT_ID,
})

const move = {
  sessionId: "se_one",
  date: "2026-07-27",
  startMinutes: 15 * 60,
  durationMinutes: 60,
}

const cancelledRow: SessionRepo.ScheduledSessionRow = {
  id: "se_one",
  clientId: "cl_maria",
  clientName: "Maria K.",
  scheduledAt: new Date("2026-07-27T07:00:00.000Z"),
  durationMinutes: 60,
  kind: "regular",
  state: "cancelled",
  cancelReason: "no_show",
  clientAccepted: true,
}

describe("CoachSessions lifecycle", () => {
  it.effect("moves a session, resolving the wall clock in the coach's own zone", () => {
    const state = emptyState()
    return run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachSessions.Service

        expect(yield* service.reschedule(yield* Effect.promise(() => credential()), move)).toEqual({
          rescheduled: true,
        })

        // 15:00 in Kyiv is 12:00 UTC in July, and the workspace comes from the
        // launch rather than from anything the browser sent.
        expect(state.moves).toEqual([
          {
            workspaceId: WORKSPACE,
            sessionId: "se_one",
            scheduledAt: new Date("2026-07-27T12:00:00.000Z"),
            durationMinutes: 60,
            now: new Date(NOW),
          },
        ])
      }),
      state,
    )
  })

  it.effect("refuses a draft the database never has to see", () => {
    const state = emptyState()
    return run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachSessions.Service
        const launch = yield* Effect.promise(() => credential())

        // Off the grid, and a length the product does not plan.
        expect(yield* service.reschedule(launch, { ...move, startMinutes: 907 })).toEqual({
          rescheduled: false,
          reason: "invalid",
        })
        expect(yield* service.reschedule(launch, { ...move, durationMinutes: 90 })).toEqual({
          rescheduled: false,
          reason: "invalid",
        })
        // 08:00 Kyiv on this day is an hour behind "now".
        expect(yield* service.reschedule(launch, { ...move, startMinutes: 8 * 60 })).toEqual({
          rescheduled: false,
          reason: "past",
        })

        expect(state.moves).toEqual([])
      }),
      state,
    )
  })

  it.effect("passes the database's own two refusals through unchanged", () => {
    const state = emptyState()
    return run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachSessions.Service
        const launch = yield* Effect.promise(() => credential())

        state.moveOutcome = { rescheduled: false, reason: "overlap" }
        expect(yield* service.reschedule(launch, move)).toEqual({
          rescheduled: false,
          reason: "overlap",
        })

        state.moveOutcome = { rescheduled: false, reason: "gone" }
        expect(yield* service.reschedule(launch, move)).toEqual({
          rescheduled: false,
          reason: "gone",
        })
      }),
      state,
    )
  })

  it.effect("cancels through the launch's workspace, and reports a refusal", () => {
    const state = emptyState()
    return run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachSessions.Service
        const launch = yield* Effect.promise(() => credential())

        expect(yield* service.cancel(launch, "se_one")).toEqual({ cancelled: true })
        expect(state.cancels).toEqual([
          { workspaceId: WORKSPACE, sessionId: "se_one", now: new Date(NOW) },
        ])

        state.cancelled = false
        expect(yield* service.cancel(launch, "se_one")).toEqual({ cancelled: false })
      }),
      state,
    )
  })

  /**
   * Fifteen minutes for a write, a day for a read (ADR 0006). The same stale
   * launch that cannot move a session can still open its screen — which is what
   * makes the shorter window cost an honest coach nothing.
   */
  it.effect("holds writes to the shorter auth window than reads", () => {
    const state = emptyState()
    state.found = cancelledRow
    return run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachSessions.Service
        const stale = yield* Effect.promise(() => credential(STALE))

        expect(yield* Effect.exit(service.reschedule(stale, move))).toMatchObject({
          _tag: "Failure",
        })
        expect(yield* Effect.exit(service.cancel(stale, "se_one"))).toMatchObject({
          _tag: "Failure",
        })
        expect(state.moves).toEqual([])
        expect(state.cancels).toEqual([])

        expect((yield* service.detail(stale, "se_one"))?.id).toBe("se_one")
      }),
      state,
    )
  })

  /** The screen cannot say «Отменена: клиент не пришёл» unless both cross. */
  it.effect("carries the state and the cancellation reason to the screen", () => {
    const state = emptyState()
    state.found = cancelledRow
    return run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachSessions.Service
        const detail = yield* service.detail(yield* Effect.promise(() => credential()), "se_one")

        expect(detail).toMatchObject({
          state: "cancelled",
          cancelReason: "no_show",
          timezone: "Europe/Kyiv",
        })
      }),
      state,
    )
  })
})
