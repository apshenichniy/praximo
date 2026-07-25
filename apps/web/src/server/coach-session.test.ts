import { describe, expect, it } from "@effect/vitest"
import { CoachInitData } from "@praximo/auth"
import { MemberRepo, QueryFailed } from "@praximo/db"
import { WorkspaceId } from "@praximo/domain"
import { Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { launchFor, TEST_PUBLIC_KEY } from "@/__tests__/coach-launch.ts"
import { CoachSession, READ_WINDOW_MILLIS } from "./coach-session.ts"
import type { LaunchCredential } from "./launch-credential.ts"

const BOT_ID = "9100777"
const AUTH_DATE = Date.parse("2026-07-23T12:00:00.000Z")
const NOW = AUTH_DATE + 60_000

type Principal = MemberRepo.CoachPrincipalRow

const failing = (): Effect.Effect<void, QueryFailed> =>
  Effect.fail(new QueryFailed({ operation: "member.touch", cause: new Error("unavailable") }))

const principal = (overrides: Partial<Principal> = {}): Principal => ({
  memberId: "mem_ada",
  workspaceId: WorkspaceId.make("ws_ada"),
  language: "en",
  botUsername: "ada_coach_bot",
  telegramBotId: BOT_ID,
  termsAcceptedAt: new Date(AUTH_DATE - 86_400_000),
  deletionPending: false,
  ...overrides,
})

/**
 * What the surface's own tests cannot reach: the bookkeeping writes, the
 * revocation floor, and the lookup a launch with no `?b=` falls back to.
 */
const sessionLayer = (options: {
  readonly byBot?: Principal | undefined
  readonly byIdentity?: Principal | undefined
  readonly bookkeepingFails?: boolean
}) => {
  const members = Layer.succeed(
    MemberRepo.Service,
    MemberRepo.Service.of({
      findCoachPrincipalByBot: Effect.fn("MemberRepo.Test.findCoachPrincipalByBot")(() =>
        Effect.succeed(options.byBot),
      ),
      findCoachPrincipalByIdentity: Effect.fn("MemberRepo.Test.findCoachPrincipalByIdentity")(() =>
        Effect.succeed(options.byIdentity),
      ),
      touchLogin: Effect.fn("MemberRepo.Test.touchLogin")(() =>
        options.bookkeepingFails === true ? failing() : Effect.void,
      ),
      touchActivity: Effect.fn("MemberRepo.Test.touchActivity")(() =>
        options.bookkeepingFails === true ? failing() : Effect.void,
      ),
      acceptTerms: Effect.fn("MemberRepo.Test.acceptTerms")(() => Effect.die("unused")),
    }),
  )
  return CoachSession.layer.pipe(
    Layer.provide(Layer.mergeAll(CoachInitData.testLayer(TEST_PUBLIC_KEY), members)),
  )
}

/** The same coach, before they have agreed to anything. */
const unaccepted: Principal = (() => {
  const { termsAcceptedAt: _accepted, ...rest } = principal()
  return rest
})()

const credential = async (botId: string): Promise<LaunchCredential> => ({
  initData: await launchFor({ botId, authDate: AUTH_DATE }),
  botId,
})

describe("CoachSession", () => {
  it.effect("authenticates even when the login bookkeeping cannot be written", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const session = yield* CoachSession.Service
      // Recording that a launch happened is not an authentication decision; a
      // database hiccup on it must not lock a coach out of their workspace.
      expect(
        yield* session.requireOnboardedCoach(
          yield* Effect.promise(() => credential(BOT_ID)),
          READ_WINDOW_MILLIS,
        ),
      ).toMatchObject({ workspaceId: "ws_ada" })
    }).pipe(Effect.provide(sessionLayer({ byBot: principal(), bookkeepingFails: true }))),
  )

  it.effect("refuses a credential minted before the member's revocation floor", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const session = yield* CoachSession.Service
      const error = yield* Effect.flip(
        session.requireOnboardedCoach(
          yield* Effect.promise(() => credential(BOT_ID)),
          READ_WINDOW_MILLIS,
        ),
      )
      // The signature is perfectly valid. Without this floor, deferring sessions
      // would also defer revocation (ADR 0006).
      expect(error._tag).toBe("CoachSession.Unauthenticated")
    }).pipe(
      Effect.provide(
        sessionLayer({
          byBot: principal({ credentialsValidFrom: new Date(AUTH_DATE + 1_000) }),
        }),
      ),
    ),
  )

  it.effect("falls back to the identity lookup when the launch carried no bot id", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const session = yield* CoachSession.Service
      // A bot provisioned before the Mini App URL grew `?b=`, or a Main Mini App
      // the coach configured from a URL they pasted themselves. The claimed user
      // id only names a candidate bot; the principal is still resolved from the
      // verified pair, and a launch claiming someone else's id would name a
      // candidate its own signature then fails against.
      const launch = {
        initData: (yield* Effect.promise(() => credential(BOT_ID))).initData,
        botId: "",
      }
      expect(yield* session.requireOnboardedCoach(launch, READ_WINDOW_MILLIS)).toMatchObject({
        memberId: "mem_ada",
      })
    }).pipe(Effect.provide(sessionLayer({ byBot: principal(), byIdentity: principal() }))),
  )

  it.effect("refuses an onboarded-only operation for a coach who has not accepted", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const session = yield* CoachSession.Service
      const launch = yield* Effect.promise(() => credential(BOT_ID))

      // The weaker gate still authenticates them — that is the whole point of
      // having two — but nothing that needs a workspace may proceed.
      expect(
        yield* session.authenticateForTermsAcceptance(launch, READ_WINDOW_MILLIS),
      ).toMatchObject({ memberId: "mem_ada" })
      expect(
        (yield* Effect.flip(session.requireOnboardedCoach(launch, READ_WINDOW_MILLIS)))._tag,
      ).toBe("CoachSession.Unauthenticated")
    }).pipe(Effect.provide(sessionLayer({ byBot: unaccepted }))),
  )
})
