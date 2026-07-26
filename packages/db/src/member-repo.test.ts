import { describe, expect, it } from "@effect/vitest"
import { TelegramId } from "@praximo/domain"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "./client.ts"
import { MemberRepo } from "./member-repo.ts"
import * as schema from "./schema.ts"
import { skipWithoutDatabase, testDatabaseUrl } from "./test-database.ts"

const uid = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12)

const ISSUED_AT = new Date("2026-07-20T10:00:00.000Z")
const EXPIRES_AT = new Date("2026-07-27T10:00:00.000Z")
const CONNECTED_AT = new Date("2026-07-21T10:00:00.000Z")
const ACCEPTED_AT = new Date("2026-07-22T10:00:00.000Z")

const TERMS_VERSION = "2026-08-01+aaaaaaa"

interface Fixture {
  readonly workspaceId: string
  readonly memberId: string
  readonly telegramBotId: string
  readonly telegramUserId: TelegramId
  readonly issuerTelegramId: string
}

/**
 * Every operation here writes across `member`, `coach_onboarding_invite` and
 * `coach_bot_notification` in one statement, and the whole subject is which
 * rows a real Postgres lets through — so these run against the dev Neon branch
 * rather than a fake.
 */
describe.skipIf(skipWithoutDatabase)("MemberRepo (dev Neon branch)", () => {
  const appLayer = Layer.provideMerge(MemberRepo.layer, Database.testLayer(testDatabaseUrl))

  /**
   * An onboarded-but-for-the-terms coach: workspace, owner member bound to a
   * Telegram identity, a connected bot, and — unless `usedInvite` is false —
   * the invite that was actually consumed, which is where the completion push
   * finds its recipient.
   */
  const coachFixture = Effect.fnUntraced(function* (
    options: { readonly usedInvite?: boolean } = {},
  ) {
    const { client } = yield* Database.Service
    const suffix = uid()
    const fixture: Fixture = {
      workspaceId: `ws_mem_${suffix}`,
      memberId: `mem_mem_${suffix}`,
      telegramBotId: `91${suffix.slice(0, 8)}`,
      telegramUserId: TelegramId.make(`81${suffix.slice(0, 8)}`),
      issuerTelegramId: `71${suffix.slice(0, 8)}`,
    }

    yield* Effect.promise(() =>
      client.insert(schema.workspace).values({ id: fixture.workspaceId, name: "Member Repo" }),
    )
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        client.delete(schema.workspace).where(eq(schema.workspace.id, fixture.workspaceId)),
      ).pipe(Effect.asVoid),
    )
    yield* Effect.promise(() =>
      client.insert(schema.member).values({
        id: fixture.memberId,
        workspaceId: fixture.workspaceId,
        role: "owner",
        language: "en",
        telegramUserId: fixture.telegramUserId,
      }),
    )
    yield* Effect.promise(() =>
      client.insert(schema.bot).values({
        workspaceId: fixture.workspaceId,
        telegramBotId: fixture.telegramBotId,
        username: `praximo_${suffix}_bot`,
        connectionStatus: "connected",
      }),
    )
    if (options.usedInvite !== false) {
      yield* Effect.promise(() =>
        client.insert(schema.coachOnboardingInvite).values({
          id: `ci_mem_${suffix}`,
          workspaceId: fixture.workspaceId,
          requestId: crypto.randomUUID(),
          requestFingerprint: `fp_${suffix}`,
          code: `DEVMEM${suffix.slice(0, 2).toUpperCase()}`,
          issuedByTelegramId: fixture.issuerTelegramId,
          status: "used",
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
          acceptedByTelegramId: fixture.telegramUserId,
          acceptedAt: ISSUED_AT,
          usedAt: CONNECTED_AT,
        }),
      )
    }
    return fixture
  })

  const notificationsFor = Effect.fnUntraced(function* (workspaceId: string) {
    const { client } = yield* Database.Service
    return yield* Effect.promise(() =>
      client
        .select({
          id: schema.coachBotNotification.id,
          kind: schema.coachBotNotification.kind,
          dedupeKey: schema.coachBotNotification.dedupeKey,
          recipientTelegramId: schema.coachBotNotification.recipientTelegramId,
          status: schema.coachBotNotification.status,
        })
        .from(schema.coachBotNotification)
        .where(eq(schema.coachBotNotification.workspaceId, workspaceId)),
    )
  })

  const memberRow = Effect.fnUntraced(function* (memberId: string) {
    const { client } = yield* Database.Service
    const rows = yield* Effect.promise(() =>
      client
        .select({
          termsAcceptedAt: schema.member.termsAcceptedAt,
          termsVersion: schema.member.termsVersion,
          lastLoginAt: schema.member.lastLoginAt,
          lastActivityAt: schema.member.lastActivityAt,
          timezone: schema.member.timezone,
          settings: schema.member.settings,
          updatedAt: schema.member.updatedAt,
        })
        .from(schema.member)
        .where(eq(schema.member.id, memberId)),
    )
    return rows[0]
  })

  /**
   * The shipped `bot_connected` row is already there when a coach accepts —
   * that is the *only* order this ever happens in — so the fixture carries it.
   * A key that could not tell the two pushes apart would look correct against a
   * clean table and silently swallow the second one here.
   */
  const seedBotConnected = Effect.fnUntraced(function* (fixture: Fixture) {
    const { client } = yield* Database.Service
    yield* Effect.promise(() =>
      client.insert(schema.coachBotNotification).values({
        id: `cbn_${fixture.workspaceId.slice(3)}_bot_connected`,
        workspaceId: fixture.workspaceId,
        kind: "bot_connected",
        dedupeKey: `bot_connected:${fixture.workspaceId}`,
        recipientTelegramId: fixture.issuerTelegramId,
        status: "delivered",
        availableAt: CONNECTED_AT,
        deliveredAt: CONNECTED_AT,
        createdAt: CONNECTED_AT,
        updatedAt: CONNECTED_AT,
      }),
    )
  })

  it.effect("records the acceptance and enqueues one push beside the delivered one", () =>
    Effect.gen(function* () {
      const repo = yield* MemberRepo.Service
      const fixture = yield* coachFixture()
      yield* seedBotConnected(fixture)

      const result = yield* repo.acceptTerms({
        memberId: fixture.memberId,
        version: TERMS_VERSION,
        now: ACCEPTED_AT,
      })
      expect(result.accepted).toBe(true)

      const member = yield* memberRow(fixture.memberId)
      expect(member?.termsAcceptedAt).toEqual(ACCEPTED_AT)
      expect(member?.termsVersion).toBe(TERMS_VERSION)

      const notifications = yield* notificationsFor(fixture.workspaceId)
      expect(notifications).toHaveLength(2)
      const queued = notifications.filter((row) => row.kind === "onboarding_complete")
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({
        dedupeKey: `onboarding_complete:${fixture.workspaceId}`,
        recipientTelegramId: fixture.issuerTelegramId,
        status: "pending",
      })
      // The id has to be a function of the kind too, or the second push would
      // collide with the first on the primary key.
      expect(queued[0]?.id).not.toBe(notifications.find((row) => row.kind === "bot_connected")?.id)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("treats a second acceptance as a no-op rather than a second push", () =>
    Effect.gen(function* () {
      const repo = yield* MemberRepo.Service
      const fixture = yield* coachFixture()

      yield* repo.acceptTerms({
        memberId: fixture.memberId,
        version: TERMS_VERSION,
        now: ACCEPTED_AT,
      })
      const again = yield* repo.acceptTerms({
        memberId: fixture.memberId,
        version: "2026-09-01+bbbbbbb",
        now: new Date("2026-07-23T10:00:00.000Z"),
      })
      expect(again.accepted).toBe(false)

      const member = yield* memberRow(fixture.memberId)
      expect(member?.termsAcceptedAt).toEqual(ACCEPTED_AT)
      expect(member?.termsVersion).toBe(TERMS_VERSION)
      expect(yield* notificationsFor(fixture.workspaceId)).toHaveLength(1)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("accepts without a push when no invite was ever consumed", () =>
    Effect.gen(function* () {
      const repo = yield* MemberRepo.Service
      const fixture = yield* coachFixture({ usedInvite: false })

      const result = yield* repo.acceptTerms({
        memberId: fixture.memberId,
        version: TERMS_VERSION,
        now: ACCEPTED_AT,
      })
      // A missing admin push must never block a coach's onboarding — the inner
      // join is what keeps this an acceptance with no row rather than a NOT NULL
      // violation that rolls the acceptance back.
      expect(result.accepted).toBe(true)
      expect((yield* memberRow(fixture.memberId))?.termsAcceptedAt).toEqual(ACCEPTED_AT)
      expect(yield* notificationsFor(fixture.workspaceId)).toHaveLength(0)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("accepts even when the push it wants to enqueue already exists", () =>
    Effect.gen(function* () {
      const repo = yield* MemberRepo.Service
      const { client } = yield* Database.Service
      const fixture = yield* coachFixture()
      yield* Effect.promise(() =>
        client.insert(schema.coachBotNotification).values({
          id: `cbn_prior_${uid()}`,
          workspaceId: fixture.workspaceId,
          kind: "onboarding_complete",
          dedupeKey: `onboarding_complete:${fixture.workspaceId}`,
          recipientTelegramId: fixture.issuerTelegramId,
          availableAt: CONNECTED_AT,
          createdAt: CONNECTED_AT,
          updatedAt: CONNECTED_AT,
        }),
      )

      // The conflict target is named, so a duplicate is absorbed while a primary
      // key collision would still surface. The remaining residual is the FK on
      // `workspace_id`: a cascade landing between authentication and this
      // statement aborts it, and the acceptance rolls back with it.
      const result = yield* repo.acceptTerms({
        memberId: fixture.memberId,
        version: TERMS_VERSION,
        now: ACCEPTED_AT,
      })
      expect(result.accepted).toBe(true)
      expect(yield* notificationsFor(fixture.workspaceId)).toHaveLength(1)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  // Written on every launch that finds it changed, and on no other. The zone is
  // what lets the *bot* print "10:00 (UTC+3)" from a Worker with no browser.
  it.effect("stores the coach's zone the first time and leaves it alone after", () =>
    Effect.gen(function* () {
      const repo = yield* MemberRepo.Service
      const fixture = yield* coachFixture()
      const first = new Date("2026-07-24T12:00:00.000Z")

      yield* repo.setTimezone({ memberId: fixture.memberId, timezone: "Europe/Kyiv", now: first })
      const stored = yield* memberRow(fixture.memberId)
      expect(stored?.timezone).toBe("Europe/Kyiv")

      const later = new Date("2026-07-25T12:00:00.000Z")
      yield* repo.setTimezone({ memberId: fixture.memberId, timezone: "Europe/Kyiv", now: later })
      // Unchanged means untouched: `updated_at` did not move either.
      expect((yield* memberRow(fixture.memberId))?.updatedAt).toEqual(stored?.updatedAt)

      yield* repo.setTimezone({ memberId: fixture.memberId, timezone: "Europe/Lisbon", now: later })
      expect((yield* memberRow(fixture.memberId))?.timezone).toBe("Europe/Lisbon")
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("replaces the settings blob wholesale", () =>
    Effect.gen(function* () {
      const repo = yield* MemberRepo.Service
      const fixture = yield* coachFixture()

      yield* repo.saveSettings({
        memberId: fixture.memberId,
        settings: { mainMiniAppHintDismissed: true },
        now: new Date("2026-07-24T12:00:00.000Z"),
      })
      expect((yield* memberRow(fixture.memberId))?.settings).toEqual({
        mainMiniAppHintDismissed: true,
      })
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("moves last login forward only, whatever order launches arrive in", () =>
    Effect.gen(function* () {
      const repo = yield* MemberRepo.Service
      const fixture = yield* coachFixture()
      const newer = new Date("2026-07-24T12:00:00.000Z")
      const older = new Date("2026-07-24T09:00:00.000Z")

      yield* repo.touchLogin({ memberId: fixture.memberId, authDateMillis: newer.getTime() })
      yield* repo.touchLogin({ memberId: fixture.memberId, authDateMillis: older.getTime() })
      expect((yield* memberRow(fixture.memberId))?.lastLoginAt).toEqual(newer)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("writes activity once per throttle window", () =>
    Effect.gen(function* () {
      const repo = yield* MemberRepo.Service
      const fixture = yield* coachFixture()
      const first = new Date("2026-07-24T12:00:00.000Z")
      const throttleMillis = 15 * 60_000

      yield* repo.touchActivity({ memberId: fixture.memberId, now: first, throttleMillis })
      yield* repo.touchActivity({
        memberId: fixture.memberId,
        now: new Date(first.getTime() + 60_000),
        throttleMillis,
      })
      expect((yield* memberRow(fixture.memberId))?.lastActivityAt).toEqual(first)

      const later = new Date(first.getTime() + throttleMillis + 1_000)
      yield* repo.touchActivity({ memberId: fixture.memberId, now: later, throttleMillis })
      expect((yield* memberRow(fixture.memberId))?.lastActivityAt).toEqual(later)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("resolves a principal only for the verified bot-and-identity pair", () =>
    Effect.gen(function* () {
      const repo = yield* MemberRepo.Service
      const fixture = yield* coachFixture()

      const found = yield* repo.findCoachPrincipalByBot(
        fixture.telegramBotId,
        fixture.telegramUserId,
      )
      expect(found).toMatchObject({
        memberId: fixture.memberId,
        workspaceId: fixture.workspaceId,
        language: "en",
        telegramBotId: fixture.telegramBotId,
        deletionPending: false,
      })
      expect(found?.termsAcceptedAt).toBeUndefined()

      expect(yield* repo.findCoachPrincipalByBot("9100000000", fixture.telegramUserId)).toBe(
        undefined,
      )
      expect(
        yield* repo.findCoachPrincipalByBot(fixture.telegramBotId, TelegramId.make("810000000")),
      ).toBe(undefined)

      // The no-`b` fallback lands on the same row, single-valued by the partial
      // unique index rather than by a tie-break.
      expect(yield* repo.findCoachPrincipalByIdentity(fixture.telegramUserId)).toMatchObject({
        memberId: fixture.memberId,
      })
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("flags a workspace whose deletion is already prepared", () =>
    Effect.gen(function* () {
      const repo = yield* MemberRepo.Service
      const { client } = yield* Database.Service
      const fixture = yield* coachFixture()
      const requestId = crypto.randomUUID()
      // Outside the tenancy cascade, so it is removed by hand.
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client
            .delete(schema.workspaceDeletionOperation)
            .where(eq(schema.workspaceDeletionOperation.requestId, requestId)),
        ).pipe(Effect.asVoid),
      )
      yield* Effect.promise(() =>
        client
          .insert(schema.workspaceDeletionOperation)
          .values({ requestId, workspaceId: fixture.workspaceId, state: "prepared" }),
      )

      // Nothing removes the coach's rows until the deletion finalizes, so the
      // flag is the only thing standing between a farewelled coach and a
      // perfectly ordinary-looking login.
      const found = yield* repo.findCoachPrincipalByBot(
        fixture.telegramBotId,
        fixture.telegramUserId,
      )
      expect(found?.deletionPending).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("refuses a second owner row for one Telegram identity", () =>
    Effect.gen(function* () {
      const { client } = yield* Database.Service
      const fixture = yield* coachFixture()
      const other = yield* coachFixture()

      const duplicate = yield* Effect.result(
        Effect.tryPromise({
          try: () =>
            client
              .update(schema.member)
              .set({ telegramUserId: fixture.telegramUserId })
              .where(eq(schema.member.id, other.memberId)),
          catch: (cause) => cause,
        }),
      )
      expect(duplicate._tag).toBe("Failure")

      // The index is partial: an owner seat nobody has claimed yet is exempt,
      // which is the state every workspace is created in.
      yield* Effect.promise(() =>
        client.insert(schema.member).values({
          id: `mem_unbound_${uid()}`,
          workspaceId: other.workspaceId,
          role: "owner",
          language: "en",
          telegramUserId: null,
        }),
      )
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )
})
