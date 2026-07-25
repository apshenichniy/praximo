import { describe, expect, it } from "@effect/vitest"
import { CoachLanguage, TelegramId } from "@praximo/domain"
import { and, eq } from "drizzle-orm"
import { Effect, Layer, Result } from "effect"
import { CoachBotProvisioningRepo } from "./coach-bot-provisioning-repo.ts"
import { CoachOnboardingRepo } from "./coach-onboarding-repo.ts"
import { Database } from "./client.ts"
import * as schema from "./schema.ts"

const DATABASE_URL = process.env.DATABASE_URL
const requestId = () => crypto.randomUUID()
const issuedByTelegramId = "100000001"
const coach = TelegramId.make("800000101")
const stranger = TelegramId.make("800000102")

const ISSUED_AT = new Date("2026-07-23T18:00:00.000Z")
const STARTED_AT = new Date("2026-07-23T19:00:00.000Z")

/**
 * The accepting `/start` (#106): the exclusive claim and the provisioning
 * attempt are taken by one statement, so these run against a real Postgres —
 * the compare-and-set and its snapshot semantics are the whole subject.
 */
describe.skipIf(!DATABASE_URL)("CoachBotProvisioningRepo claim (dev Neon branch)", () => {
  const appLayer = Layer.provideMerge(
    Layer.mergeAll(CoachBotProvisioningRepo.layer, CoachOnboardingRepo.layer),
    Database.testLayer(DATABASE_URL ?? ""),
  )

  const inviteFor = Effect.fnUntraced(function* (fingerprint: string, issuedAt: Date) {
    const onboarding = yield* CoachOnboardingRepo.Service
    const { client } = yield* Database.Service
    const created = yield* onboarding.createOrGet({
      requestId: requestId(),
      requestFingerprint: fingerprint,
      name: "Claim Coaching",
      coachLanguage: CoachLanguage.make("en"),
      issuedByTelegramId,
      now: issuedAt,
    })
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        client
          .delete(schema.workspace)
          .where(eq(schema.workspace.id, created.aggregate.workspace.id)),
      ).pipe(Effect.asVoid),
    )
    return created.aggregate
  })

  it.effect("accepts on the first /start and resumes the same identity idempotently", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const onboarding = yield* CoachOnboardingRepo.Service
      const aggregate = yield* inviteFor("first-start", ISSUED_AT)

      const first = yield* repo.prepare(aggregate.invite.id, coach, STARTED_AT)
      expect(first.status).toBe("requested")
      expect(first.coachTelegramId).toBe(coach)

      const claimed = (yield* onboarding.findInvite(aggregate.invite.id)).invite
      expect(claimed.status).toBe("accepted")
      expect(claimed.acceptedByTelegramId).toBe(coach)
      expect(claimed.acceptedAt).toEqual(STARTED_AT)

      // A repeated `/start` resumes: same attempt, and the claim keeps the
      // moment it was actually taken rather than sliding forward.
      const resumed = yield* repo.prepare(
        aggregate.invite.id,
        coach,
        new Date("2026-07-25T09:00:00.000Z"),
      )
      expect(resumed.id).toBe(first.id)
      expect(resumed.status).toBe("requested")
      expect((yield* onboarding.findInvite(aggregate.invite.id)).invite.acceptedAt).toEqual(
        STARTED_AT,
      )
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("refuses a competing identity without disclosing the claimant", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const onboarding = yield* CoachOnboardingRepo.Service
      const aggregate = yield* inviteFor("competing-start", ISSUED_AT)

      yield* repo.prepare(aggregate.invite.id, coach, STARTED_AT)
      const refused = yield* Effect.flip(
        repo.prepare(aggregate.invite.id, stranger, new Date("2026-07-23T19:05:00.000Z")),
      )
      // `claimed` is the generic answer — the bot's copy for it says only that
      // the link has already been used (#112).
      expect(refused).toMatchObject({
        _tag: "CoachBotProvisioningRepo.ProvisioningUnavailable",
        reason: "claimed",
      })

      const claimed = (yield* onboarding.findInvite(aggregate.invite.id)).invite
      expect(claimed.acceptedByTelegramId).toBe(coach)
      // The refused identity got no attempt row it could later advance.
      const { client } = yield* Database.Service
      const attempts = yield* Effect.promise(() =>
        client
          .select({ id: schema.coachBotProvisioning.id })
          .from(schema.coachBotProvisioning)
          .where(
            and(
              eq(schema.coachBotProvisioning.inviteId, aggregate.invite.id),
              eq(schema.coachBotProvisioning.coachTelegramId, stranger),
            ),
          ),
      )
      expect(attempts).toHaveLength(0)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("lets exactly one of two racing identities take the claim", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const onboarding = yield* CoachOnboardingRepo.Service
      const aggregate = yield* inviteFor("racing-start", ISSUED_AT)

      const attempts = yield* Effect.all(
        [
          repo.prepare(aggregate.invite.id, coach, STARTED_AT).pipe(Effect.result),
          repo.prepare(aggregate.invite.id, stranger, STARTED_AT).pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      )
      expect(attempts.filter(Result.isSuccess)).toHaveLength(1)
      expect(attempts.filter(Result.isFailure)).toHaveLength(1)

      const claimed = (yield* onboarding.findInvite(aggregate.invite.id)).invite
      expect(claimed.status).toBe("accepted")
      expect([coach, stranger]).toContain(claimed.acceptedByTelegramId)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("never accepts an invite whose TTL has already lapsed", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const onboarding = yield* CoachOnboardingRepo.Service
      const aggregate = yield* inviteFor("lapsed-start", ISSUED_AT)

      const refused = yield* Effect.flip(
        repo.prepare(aggregate.invite.id, coach, new Date("2026-08-30T18:00:00.000Z")),
      )
      expect(refused).toMatchObject({
        _tag: "CoachBotProvisioningRepo.ProvisioningUnavailable",
        reason: "expired",
      })
      expect((yield* onboarding.findInvite(aggregate.invite.id)).invite.status).toBe("pending")
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )
})
