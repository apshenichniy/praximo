import { describe, expect, it } from "@effect/vitest"
import { CoachLanguage, TelegramId } from "@praximo/domain"
import { and, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { CoachBotHealthRepo } from "./coach-bot-health-repo.ts"
import { CoachBotProvisioningRepo } from "./coach-bot-provisioning-repo.ts"
import { CoachOnboardingRepo } from "./coach-onboarding-repo.ts"
import { Database } from "./client.ts"
import * as schema from "./schema.ts"
import { skipWithoutDatabase, testDatabaseUrl } from "./test-database.ts"

/**
 * The re-link slice (#55), against a real Postgres because every claim it makes
 * is about one statement's atomicity: the flip is a conditional update that
 * queues both notifications from the row it returned, and the recovery reuses
 * the very attempt row the first bot came from.
 */

const issuedByTelegramId = "100000001"
const coach = TelegramId.make("800000301")
const FIRST_BOT = "9300010"
const SECOND_BOT = "9300011"

const ISSUED_AT = new Date("2026-07-23T18:00:00.000Z")
const STARTED_AT = new Date("2026-07-23T19:00:00.000Z")
const BROKE_AT = new Date("2026-07-24T10:00:00.000Z")
const RECONNECTED_AT = new Date("2026-07-24T11:00:00.000Z")

describe.skipIf(skipWithoutDatabase)("coach bot re-link (dev Neon branch)", () => {
  const appLayer = Layer.provideMerge(
    Layer.mergeAll(
      CoachBotProvisioningRepo.layer,
      CoachBotHealthRepo.layer,
      CoachOnboardingRepo.layer,
    ),
    Database.testLayer(testDatabaseUrl),
  )

  /** A workspace with a connected bot — the only state a re-link starts from. */
  const connectedWorkspace = Effect.fnUntraced(function* (fingerprint: string) {
    const onboarding = yield* CoachOnboardingRepo.Service
    const repo = yield* CoachBotProvisioningRepo.Service
    const { client } = yield* Database.Service
    const created = yield* onboarding.createOrGet({
      requestId: crypto.randomUUID(),
      requestFingerprint: fingerprint,
      name: "Relink Coaching",
      coachLanguage: CoachLanguage.make("uk"),
      issuedByTelegramId,
      now: ISSUED_AT,
    })
    const aggregate = created.aggregate
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        client.delete(schema.workspace).where(eq(schema.workspace.id, aggregate.workspace.id)),
      ).pipe(Effect.asVoid),
    )
    const attempt = yield* repo.prepare(aggregate.invite.id, coach, STARTED_AT)
    yield* repo.claim(coach, FIRST_BOT, "ada_first_bot", STARTED_AT)
    yield* repo.complete({
      provisioningId: attempt.id,
      encryptedToken: "sealed:first",
      webhookSecretHash: "hash-first",
      botInfo: { id: Number(FIRST_BOT), is_bot: true, username: "ada_first_bot" },
      now: STARTED_AT,
    })
    return { aggregate, attempt }
  })

  const notificationsFor = Effect.fnUntraced(function* (workspaceId: string, kind: string) {
    const { client } = yield* Database.Service
    return yield* Effect.promise(() =>
      client
        .select({
          dedupeKey: schema.coachBotNotification.dedupeKey,
          role: schema.coachBotNotification.recipientRole,
          recipient: schema.coachBotNotification.recipientTelegramId,
        })
        .from(schema.coachBotNotification)
        .where(
          and(
            eq(schema.coachBotNotification.workspaceId, workspaceId),
            eq(schema.coachBotNotification.kind, kind),
          ),
        ),
    )
  })

  it.effect("flips once however many refusals arrive, and tells both parties", () =>
    Effect.gen(function* () {
      const health = yield* CoachBotHealthRepo.Service
      const { aggregate } = yield* connectedWorkspace("relink-flip")

      const first = yield* health.flagNeedsRelink(aggregate.workspace.id, BROKE_AT)
      const second = yield* health.flagNeedsRelink(aggregate.workspace.id, BROKE_AT)

      expect(first).toMatchObject({ botUsername: "ada_first_bot", episode: 1 })
      // The second 401 about the same dead bot changes nothing and announces
      // nothing: the update is conditional on `connected`, so only one caller
      // can ever reach the insert.
      expect(second).toBeUndefined()

      const queued = yield* notificationsFor(aggregate.workspace.id, "needs_relink")
      expect(queued).toHaveLength(2)
      expect(new Set(queued.map((row) => row.role))).toEqual(new Set(["coach", "admin"]))
      // The recipient rides in the key, because two rows cannot share one.
      expect(new Set(queued.map((row) => row.dedupeKey))).toEqual(
        new Set([
          `needs_relink:${aggregate.workspace.id}:1:coach`,
          `needs_relink:${aggregate.workspace.id}:1:admin`,
        ]),
      )
      expect(queued.find((row) => row.role === "coach")?.recipient).toBe(coach)
      expect(queued.find((row) => row.role === "admin")?.recipient).toBe(issuedByTelegramId)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("carries the coach back through the same attempt row and onto a new bot", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const health = yield* CoachBotHealthRepo.Service
      const { aggregate, attempt } = yield* connectedWorkspace("relink-recovery")
      yield* health.flagNeedsRelink(aggregate.workspace.id, BROKE_AT)

      const reopened = yield* repo.reopenForRelink(coach, RECONNECTED_AT)
      // The same row, not a second one: its id is a pure function of (invite,
      // coach), and the invitation stays used — its public code is dead.
      expect(reopened?.id).toBe(attempt.id)
      expect(reopened?.status).toBe("requested")

      // Idempotent, because the recovery link has to work more than once.
      expect((yield* repo.reopenForRelink(coach, RECONNECTED_AT))?.id).toBe(attempt.id)

      const claimed = yield* repo.claim(coach, SECOND_BOT, "ada_second_bot", RECONNECTED_AT)
      expect(claimed.id).toBe(attempt.id)

      const activation = yield* repo.complete({
        provisioningId: attempt.id,
        encryptedToken: "sealed:second",
        webhookSecretHash: "hash-second",
        botInfo: { id: Number(SECOND_BOT), is_bot: true, username: "ada_second_bot" },
        now: RECONNECTED_AT,
      })

      // A different bot overwrites the row in place: `bot` is keyed by workspace,
      // so the old bot id simply stops being ours.
      expect(activation).toMatchObject({
        telegramBotId: SECOND_BOT,
        username: "ada_second_bot",
        reconnected: true,
      })
      expect(yield* repo.findByWorkspace(aggregate.workspace.id)).toMatchObject({
        telegramBotId: SECOND_BOT,
      })

      const closed = yield* notificationsFor(aggregate.workspace.id, "relink_completed")
      expect(closed).toHaveLength(1)
      expect(closed[0]).toMatchObject({
        role: "admin",
        recipient: issuedByTelegramId,
        dedupeKey: `relink_completed:${aggregate.workspace.id}:1`,
      })
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("has nothing to reopen for a coach whose bot is fine", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      yield* connectedWorkspace("relink-healthy")

      expect(yield* repo.reopenForRelink(coach, RECONNECTED_AT)).toBeUndefined()
      // …and for somebody who is not a coach at all.
      expect(
        yield* repo.reopenForRelink(TelegramId.make("800000399"), RECONNECTED_AT),
      ).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("hands the sweep the bots it has not asked about, oldest first", () =>
    Effect.gen(function* () {
      const health = yield* CoachBotHealthRepo.Service
      const { aggregate } = yield* connectedWorkspace("relink-sweep")

      // Activation stamps the check, so a freshly connected bot is not due.
      const fresh = yield* health.dueForCheck(new Date(STARTED_AT.getTime() - 1), 50)
      expect(fresh.map((row) => row.workspaceId)).not.toContain(aggregate.workspace.id)

      const due = yield* health.dueForCheck(BROKE_AT, 50)
      const target = due.find((row) => row.workspaceId === aggregate.workspace.id)
      expect(target).toMatchObject({
        telegramBotId: FIRST_BOT,
        username: "ada_first_bot",
        encryptedToken: "sealed:first",
        webhookSecretHash: "hash-first",
        coachTelegramId: coach,
        coachLanguage: "uk",
        relinkEpisode: 0,
      })
      expect(target?.workspace.name).toBe("Relink Coaching")

      yield* health.markChecked(aggregate.workspace.id, BROKE_AT)
      const afterCheck = yield* health.dueForCheck(BROKE_AT, 50)
      expect(afterCheck.map((row) => row.workspaceId)).not.toContain(aggregate.workspace.id)

      // A flagged bot is nobody's to sweep: only a completed re-link brings it
      // back, so probing it again would ask a question with no answer.
      yield* health.flagNeedsRelink(aggregate.workspace.id, BROKE_AT)
      const afterFlip = yield* health.dueForCheck(RECONNECTED_AT, 50)
      expect(afterFlip.map((row) => row.workspaceId)).not.toContain(aggregate.workspace.id)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("tells a repaired coach once per episode, and nobody else", () =>
    Effect.gen(function* () {
      const health = yield* CoachBotHealthRepo.Service
      const { aggregate } = yield* connectedWorkspace("relink-repair-notice")

      yield* health.queueRepairNotice(aggregate.workspace.id, 0, BROKE_AT)
      yield* health.queueRepairNotice(aggregate.workspace.id, 0, RECONNECTED_AT)

      const queued = yield* notificationsFor(aggregate.workspace.id, "bot_repaired")
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({ role: "coach", recipient: coach })

      // A later episode is a different event and gets its own row: a coach who
      // revokes twice is told twice.
      yield* health.queueRepairNotice(aggregate.workspace.id, 1, RECONNECTED_AT)
      expect(yield* notificationsFor(aggregate.workspace.id, "bot_repaired")).toHaveLength(2)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )
})
