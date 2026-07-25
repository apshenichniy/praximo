import { describe, expect, it } from "@effect/vitest"
import { CoachInitData, CoachOnboardingToken } from "@praximo/auth"
import { MemberRepo } from "@praximo/db"
import { WorkspaceId } from "@praximo/domain"
import { Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { launchFor, TEST_PUBLIC_KEY } from "@/__tests__/coach-launch.ts"
import { TERMS_VERSION } from "@/features/legal/versions.ts"
import { CoachSession } from "./coach-session.ts"
import { CoachSurface } from "./coach-surface.ts"
import type { LaunchCredential } from "./launch-credential.ts"

const BOT_ID = "9100777"
const OTHER_BOT_ID = "9100778"
const MEMBER_ID = "mem_ada"
const MANAGER_BOT_USERNAME = "PraximoMotherDevBot"
const AUTH_DATE = Date.parse("2026-07-23T12:00:00.000Z")
const NOW = AUTH_DATE + 60_000

type Principal = MemberRepo.CoachPrincipalRow

const principal = (overrides: Partial<Principal> = {}): Principal => ({
  memberId: MEMBER_ID,
  workspaceId: WorkspaceId.make("ws_ada"),
  language: "en",
  botUsername: "ada_coach_bot",
  telegramBotId: BOT_ID,
  botConnectionStatus: "connected",
  deletionPending: false,
  ...overrides,
})

interface Recorded {
  readonly accepted: Array<{ readonly memberId: string; readonly version: string }>
  readonly logins: Array<number>
}

/**
 * The whole surface over one substituted repository, per #35's rule that a
 * slice is tested at its top-level service. The member is a single mutable row
 * because the accept path reads back what it just wrote — a store that could
 * not see its own write would make that step untestable.
 */
const run = <A, E>(
  member: Principal | undefined,
  body: (recorded: Recorded) => Effect.Effect<A, E, CoachSurface.Service>,
) => {
  const recorded: Recorded = { accepted: [], logins: [] }
  let row = member
  const members = Layer.succeed(
    MemberRepo.Service,
    MemberRepo.Service.of({
      findCoachPrincipalByBot: Effect.fn("MemberRepo.Test.findCoachPrincipalByBot")(
        (telegramBotId) => Effect.succeed(row?.telegramBotId === telegramBotId ? row : undefined),
      ),
      findCoachPrincipalByIdentity: Effect.fn("MemberRepo.Test.findCoachPrincipalByIdentity")(() =>
        Effect.succeed(row),
      ),
      touchLogin: Effect.fn("MemberRepo.Test.touchLogin")((input) =>
        Effect.sync(() => {
          recorded.logins.push(input.authDateMillis)
        }),
      ),
      touchActivity: Effect.fn("MemberRepo.Test.touchActivity")(() => Effect.void),
      acceptTerms: Effect.fn("MemberRepo.Test.acceptTerms")((input) =>
        Effect.sync(() => {
          if (row === undefined || row.termsAcceptedAt !== undefined) return { accepted: false }
          recorded.accepted.push({ memberId: input.memberId, version: input.version })
          row = { ...row, termsAcceptedAt: input.now, termsVersion: input.version }
          return { accepted: true }
        }),
      ),
    }),
  )

  return body(recorded).pipe(
    Effect.provide(
      CoachSurface.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            members,
            CoachOnboardingToken.testLayer(MANAGER_BOT_USERNAME),
            CoachSession.layer.pipe(
              Layer.provide(Layer.mergeAll(CoachInitData.testLayer(TEST_PUBLIC_KEY), members)),
            ),
          ),
        ),
      ),
    ),
  )
}

const credential = async (
  options: { readonly signedFor?: string; readonly presentedAs?: string } = {},
): Promise<LaunchCredential> => ({
  initData: await launchFor({ botId: options.signedFor ?? BOT_ID, authDate: AUTH_DATE }),
  botId: options.presentedAs ?? options.signedFor ?? BOT_ID,
})

describe("CoachSurface", () => {
  it.effect("refuses a launch from a bot no member is bound to", () =>
    run(principal({ telegramBotId: OTHER_BOT_ID }), () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachSurface.Service
        const error = yield* Effect.flip(service.openApp(yield* Effect.promise(() => credential())))
        expect(error._tag).toBe("CoachSession.Unauthenticated")
      }),
    ),
  )

  it.effect("refuses a signature minted for a different bot", () =>
    run(principal(), () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachSurface.Service
        const forged = yield* Effect.promise(() =>
          credential({ signedFor: OTHER_BOT_ID, presentedAs: BOT_ID }),
        )
        expect((yield* Effect.flip(service.openApp(forged)))._tag).toBe(
          "CoachSession.Unauthenticated",
        )
      }),
    ),
  )

  it.effect("sends an unaccepted coach to the terms and an accepted one home", () =>
    run(principal(), (recorded) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachSurface.Service
        const launch = yield* Effect.promise(() => credential())

        expect(yield* service.openApp(launch)).toEqual({
          kind: "terms-required",
          termsVersion: TERMS_VERSION,
        })

        expect(yield* service.acceptTerms(launch, TERMS_VERSION)).toMatchObject({
          kind: "home",
          botUsername: "ada_coach_bot",
          telegramBotId: BOT_ID,
        })
        // The server's own constant is what gets written, never the caller's.
        expect(recorded.accepted).toEqual([{ memberId: MEMBER_ID, version: TERMS_VERSION }])

        // A second tap is idempotent, and a reopen goes straight home.
        expect(yield* service.acceptTerms(launch, TERMS_VERSION)).toMatchObject({ kind: "home" })
        expect(recorded.accepted).toHaveLength(1)
        expect(yield* service.openApp(launch)).toMatchObject({ kind: "home" })

        // Every login is recorded from the credential's own auth_date, never a
        // server clock reading.
        expect(new Set(recorded.logins)).toEqual(new Set([AUTH_DATE]))
      }),
    ),
  )

  it.effect("refuses a stale terms version without writing anything", () =>
    run(principal(), (recorded) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachSurface.Service
        const launch = yield* Effect.promise(() => credential())

        expect(yield* Effect.flip(service.acceptTerms(launch, "2020-01-01+deadbee"))).toMatchObject(
          { _tag: "CoachSurface.StaleTermsVersion", current: TERMS_VERSION },
        )
        expect(recorded.accepted).toHaveLength(0)
      }),
    ),
  )

  it.effect("keeps a coach who accepted an older version onboarded", () =>
    run(
      principal({
        termsAcceptedAt: new Date(AUTH_DATE - 86_400_000),
        termsVersion: "2026-01-01+0",
      }),
      () =>
        Effect.gen(function* () {
          yield* TestClock.setTime(NOW)
          // A version bump records what was accepted; it does not force
          // re-acceptance, and no re-acceptance flow exists (ADR 0006).
          expect(
            yield* (yield* CoachSurface.Service).openApp(yield* Effect.promise(() => credential())),
          ).toMatchObject({ kind: "home" })
        }),
    ),
  )

  it.effect("hands a coach whose bot died the one link that repairs it", () =>
    run(
      principal({
        termsAcceptedAt: new Date(AUTH_DATE - 86_400_000),
        botConnectionStatus: "needs-relink",
      }),
      () =>
        Effect.gen(function* () {
          yield* TestClock.setTime(NOW)
          // The app still opens, and that is the point: the launch is signed by
          // Telegram over the bot id with no token involved, so this surface
          // survives the bot that carries it (#55). Nothing is blocked — the
          // delivery channel broke, not the data — so it is a banner on the
          // home screen rather than a wall.
          expect(
            yield* (yield* CoachSurface.Service).openApp(yield* Effect.promise(() => credential())),
          ).toMatchObject({
            kind: "home",
            relink: { link: `https://t.me/${MANAGER_BOT_USERNAME}?start=relink` },
          })
        }),
    ),
  )

  it.effect("says nothing about re-linking while the bot is fine", () =>
    run(principal({ termsAcceptedAt: new Date(AUTH_DATE - 86_400_000) }), () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const entry = yield* (yield* CoachSurface.Service).openApp(
          yield* Effect.promise(() => credential()),
        )
        expect(entry).toMatchObject({ kind: "home" })
        expect(entry.kind === "home" ? entry.relink : undefined).toBeUndefined()
      }),
    ),
  )

  it.effect("refuses a coach whose workspace deletion is already prepared", () =>
    run(principal({ deletionPending: true }), () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const error = yield* Effect.flip(
          (yield* CoachSurface.Service).openApp(yield* Effect.promise(() => credential())),
        )
        // Undifferentiated from an unknown bot. The coach has already had the
        // farewell, and "your workspace is active" would be the wrong answer.
        expect(error._tag).toBe("CoachSession.Unauthenticated")
      }),
    ),
  )

  it.effect("refuses an acceptance outside the short write window", () =>
    run(principal(), (recorded) =>
      Effect.gen(function* () {
        const service = yield* CoachSurface.Service
        const launch = yield* Effect.promise(() => credential())

        // Twenty minutes on, the entry still opens…
        yield* TestClock.setTime(AUTH_DATE + 20 * 60_000)
        expect(yield* service.openApp(launch)).toMatchObject({ kind: "terms-required" })
        // …but the write the coach is legally bound by does not.
        expect((yield* Effect.flip(service.acceptTerms(launch, TERMS_VERSION)))._tag).toBe(
          "CoachSession.Unauthenticated",
        )
        expect(recorded.accepted).toHaveLength(0)
      }),
    ),
  )
})
