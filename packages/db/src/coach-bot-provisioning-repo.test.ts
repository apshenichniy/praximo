import { describe, expect, it } from "@effect/vitest"
import { CoachLanguage, TelegramId } from "@praximo/domain"
import { and, eq } from "drizzle-orm"
import { Effect, Layer, Result } from "effect"
import { CoachBotProvisioningRepo } from "./coach-bot-provisioning-repo.ts"
import { CoachOnboardingRepo } from "./coach-onboarding-repo.ts"
import { MemberRepo } from "./member-repo.ts"
import { Database } from "./client.ts"
import * as schema from "./schema.ts"
import { skipWithoutDatabase, testDatabaseUrl } from "./test-database.ts"

const requestId = () => crypto.randomUUID()
const issuedByTelegramId = "100000001"
const coach = TelegramId.make("800000101")
const stranger = TelegramId.make("800000102")

/** What the sender's Telegram client was set to when they tapped the link. */
const EN = CoachLanguage.make("en")
const UK = CoachLanguage.make("uk")
const RU = CoachLanguage.make("ru")

const ISSUED_AT = new Date("2026-07-23T18:00:00.000Z")
const STARTED_AT = new Date("2026-07-23T19:00:00.000Z")

/**
 * The accepting `/start` (#106): the exclusive claim and the provisioning
 * attempt are taken by one statement, so these run against a real Postgres —
 * the compare-and-set and its snapshot semantics are the whole subject.
 */
describe.skipIf(skipWithoutDatabase)("CoachBotProvisioningRepo claim (dev Neon branch)", () => {
  const appLayer = Layer.provideMerge(
    Layer.mergeAll(CoachBotProvisioningRepo.layer, CoachOnboardingRepo.layer, MemberRepo.layer),
    Database.testLayer(testDatabaseUrl),
  )

  const inviteFor = Effect.fnUntraced(function* (fingerprint: string, issuedAt: Date) {
    const onboarding = yield* CoachOnboardingRepo.Service
    const { client } = yield* Database.Service
    const created = yield* onboarding.createOrGet({
      requestId: requestId(),
      requestFingerprint: fingerprint,
      name: "Claim Coaching",
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

      const first = yield* repo.prepare(aggregate.invite.id, coach, EN, STARTED_AT)
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
        EN,
        new Date("2026-07-25T09:00:00.000Z"),
      )
      expect(resumed.id).toBe(first.id)
      expect(resumed.status).toBe("requested")
      expect((yield* onboarding.findInvite(aggregate.invite.id)).invite.acceptedAt).toEqual(
        STARTED_AT,
      )
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  /**
   * The first of `member.language`'s two writers (#130). Creation leaves the
   * owner on the column default, and the accepting `/start` is the first moment
   * a signal from the coach themselves exists.
   */
  it.effect("seeds the owner's language from the claiming /start, once", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const { client } = yield* Database.Service
      const aggregate = yield* inviteFor("language-seed", ISSUED_AT)

      const ownerLanguage = Effect.fnUntraced(function* () {
        const rows = yield* Effect.promise(() =>
          client
            .select({ language: schema.member.language })
            .from(schema.member)
            .where(
              and(
                eq(schema.member.workspaceId, aggregate.workspace.id),
                eq(schema.member.role, "owner"),
              ),
            )
            .limit(1),
        )
        return rows[0]?.language
      })

      // Born on the default: the admin who created this workspace was never
      // asked, and never should be.
      expect(yield* ownerLanguage()).toBe("en")

      yield* repo.prepare(aggregate.invite.id, coach, UK, STARTED_AT)
      expect(yield* ownerLanguage()).toBe("uk")

      // The coach then chose Russian for themselves in the Mini App…
      const members = yield* MemberRepo.Service
      yield* members.setLanguage({
        memberId: `mem_${aggregate.workspace.id.replace("ws_", "")}`,
        language: RU,
        now: new Date("2026-07-25T08:00:00.000Z"),
      })

      // …and a later `/start` — a coach returning to the chat — must not walk
      // back over it. The seed rides on the claim, which is already taken.
      yield* repo.prepare(aggregate.invite.id, coach, UK, new Date("2026-07-25T09:00:00.000Z"))
      expect(yield* ownerLanguage()).toBe("ru")
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("carries the live creation prompt across a repeated /start and into the claim", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const aggregate = yield* inviteFor("prompt-message", ISSUED_AT)

      // Nothing has been sent yet, so there is no prompt to disarm.
      const first = yield* repo.prepare(aggregate.invite.id, coach, EN, STARTED_AT)
      expect(first.promptMessageId).toBeUndefined()

      yield* repo.recordPrompt(first.id, 401, STARTED_AT)

      // The point of recording it: the *next* `/start` reads back the message it
      // has to disarm before it may send another (#134).
      const resumed = yield* repo.prepare(
        aggregate.invite.id,
        coach,
        EN,
        new Date("2026-07-25T09:00:00.000Z"),
      )
      expect(resumed.id).toBe(first.id)
      expect(resumed.promptMessageId).toBe(401)

      yield* repo.recordPrompt(first.id, 402, new Date("2026-07-25T09:00:01.000Z"))

      // And activation reads it off the claimed attempt, which is what makes the
      // prompt editable in place once the bot is connected.
      const claimed = yield* repo.claim(
        coach,
        "9100010",
        "ada_coach_bot",
        new Date("2026-07-25T09:05:00.000Z"),
      )
      expect(claimed.id).toBe(first.id)
      expect(claimed.promptMessageId).toBe(402)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("refuses a competing identity without disclosing the claimant", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const onboarding = yield* CoachOnboardingRepo.Service
      const aggregate = yield* inviteFor("competing-start", ISSUED_AT)

      yield* repo.prepare(aggregate.invite.id, coach, EN, STARTED_AT)
      const refused = yield* Effect.flip(
        repo.prepare(aggregate.invite.id, stranger, EN, new Date("2026-07-23T19:05:00.000Z")),
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
          repo.prepare(aggregate.invite.id, coach, EN, STARTED_AT).pipe(Effect.result),
          repo.prepare(aggregate.invite.id, stranger, EN, STARTED_AT).pipe(Effect.result),
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
        repo.prepare(aggregate.invite.id, coach, EN, new Date("2026-08-30T18:00:00.000Z")),
      )
      expect(refused).toMatchObject({
        _tag: "CoachBotProvisioningRepo.ProvisioningUnavailable",
        reason: "expired",
      })
      expect((yield* onboarding.findInvite(aggregate.invite.id)).invite.status).toBe("pending")
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  /**
   * The BotFather fallback (#95). The pasted credential is parked encrypted on
   * the same attempt row and buys nothing until the ownership handshake, so
   * these cover what the row may hold, who may replace it, and that activation
   * leaves none of the one-shot proof material behind.
   */
  const candidate = {
    botId: "9100001",
    botUsername: "ada_fallback_bot",
    encryptedToken: "v1.aXZhaXZhaXZhaXY.Y2lwaGVydGV4dA",
    proofHash: "a".repeat(64),
    webhookSecretHash: "b".repeat(64),
  }

  it.effect("parks a pasted candidate on the coach's open attempt and reads it back", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const aggregate = yield* inviteFor("paste-start", ISSUED_AT)

      yield* repo.prepare(aggregate.invite.id, coach, UK, STARTED_AT)
      const ingested = yield* repo.ingestCandidate({
        coachTelegramId: coach,
        ...candidate,
        now: STARTED_AT,
      })
      // The paste alone never advances the attempt: activation waits on proof.
      expect(ingested.status).toBe("requested")
      expect(ingested.coachLanguage).toBe("uk")

      const parked = yield* repo.findCandidateByBotId(candidate.botId)
      expect(parked).toMatchObject({
        provisioningId: ingested.id,
        coachTelegramId: coach,
        botId: candidate.botId,
        botUsername: candidate.botUsername,
        encryptedToken: candidate.encryptedToken,
        proofHash: candidate.proofHash,
        webhookSecretHash: candidate.webhookSecretHash,
        status: "requested",
        coachLanguage: "uk",
      })
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("replaces the parked proof secrets when the same coach pastes again", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const aggregate = yield* inviteFor("paste-again", ISSUED_AT)

      yield* repo.prepare(aggregate.invite.id, coach, EN, STARTED_AT)
      const first = yield* repo.ingestCandidate({
        coachTelegramId: coach,
        ...candidate,
        botId: "9100002",
        now: STARTED_AT,
      })
      const second = yield* repo.ingestCandidate({
        coachTelegramId: coach,
        ...candidate,
        botId: "9100002",
        proofHash: "c".repeat(64),
        webhookSecretHash: "d".repeat(64),
        now: new Date("2026-07-23T19:30:00.000Z"),
      })
      expect(second.id).toBe(first.id)

      // The superseded nonce and webhook secret stop being accepted.
      const parked = yield* repo.findCandidateByBotId("9100002")
      expect(parked.proofHash).toBe("c".repeat(64))
      expect(parked.webhookSecretHash).toBe("d".repeat(64))
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("refuses a candidate another identity is already onboarding", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const mine = yield* inviteFor("paste-mine", ISSUED_AT)
      const theirs = yield* inviteFor("paste-theirs", ISSUED_AT)

      yield* repo.prepare(mine.invite.id, coach, EN, STARTED_AT)
      yield* repo.prepare(theirs.invite.id, stranger, EN, STARTED_AT)
      yield* repo.ingestCandidate({
        coachTelegramId: coach,
        ...candidate,
        botId: "9100003",
        now: STARTED_AT,
      })

      const refused = yield* Effect.flip(
        repo.ingestCandidate({
          coachTelegramId: stranger,
          ...candidate,
          botId: "9100003",
          now: STARTED_AT,
        }),
      )
      expect(refused).toMatchObject({
        _tag: "CoachBotProvisioningRepo.ProvisioningUnavailable",
        reason: "claimed",
      })
      // The first coach keeps the parked candidate untouched.
      expect((yield* repo.findCandidateByBotId("9100003")).coachTelegramId).toBe(coach)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("names the invitation's own lifecycle when it refuses a paste", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const { client } = yield* Database.Service
      const aggregate = yield* inviteFor("paste-reset", ISSUED_AT)

      yield* repo.prepare(aggregate.invite.id, coach, EN, STARTED_AT)
      // An administrator resets the invitation while the coach still holds the
      // chat open (#112). The paste must say the link is dead, not that the
      // coach never opened one.
      yield* Effect.promise(() =>
        client
          .update(schema.coachOnboardingInvite)
          .set({
            status: "cancelled",
            cancellationReason: "reset_by_admin",
            cancelledAt: ISSUED_AT,
          })
          .where(eq(schema.coachOnboardingInvite.id, aggregate.invite.id)),
      )

      const refused = yield* Effect.flip(
        repo.ingestCandidate({
          coachTelegramId: coach,
          ...candidate,
          botId: "9100006",
          now: STARTED_AT,
        }),
      )
      expect(refused).toMatchObject({
        _tag: "CoachBotProvisioningRepo.ProvisioningUnavailable",
        reason: "cancelled",
      })
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("refuses a paste from an identity with no open attempt", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      yield* inviteFor("paste-unopened", ISSUED_AT)

      const refused = yield* Effect.flip(
        repo.ingestCandidate({
          coachTelegramId: TelegramId.make("800000103"),
          ...candidate,
          botId: "9100004",
          now: STARTED_AT,
        }),
      )
      expect(refused).toMatchObject({
        _tag: "CoachBotProvisioningRepo.ProvisioningUnavailable",
        reason: "not-found",
      })
      expect((yield* Effect.flip(repo.findCandidateByBotId("9100004")))._tag).toBe(
        "CoachBotProvisioningRepo.CandidateNotFound",
      )
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  /**
   * The second managed bot (#135). A coach who taps the creation entry point
   * twice has no open attempt left by the time the second `managed_bot` update
   * arrives, so the fence refuses it. What must be true of that refusal: it is
   * the typed `not-found`, and the bot the first tap installed is untouched.
   */
  it.effect("refuses a second bot for a finished coach and leaves the first installed", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const aggregate = yield* inviteFor("second-bot", ISSUED_AT)

      const attempt = yield* repo.prepare(aggregate.invite.id, coach, EN, STARTED_AT)
      yield* repo.claim(coach, "9100010", "ada_first_bot", STARTED_AT)
      const installed = yield* repo.complete({
        provisioningId: attempt.id,
        encryptedToken: candidate.encryptedToken,
        webhookSecretHash: candidate.webhookSecretHash,
        botInfo: { id: 9100010, is_bot: true, username: "ada_first_bot" },
        now: STARTED_AT,
      })
      expect(installed.telegramBotId).toBe("9100010")

      const refused = yield* Effect.flip(
        repo.claim(coach, "9100011", "ada_second_bot", new Date("2026-07-23T19:20:00.000Z")),
      )
      // `not-found` and nothing else: the terminal answer the webhook turns into
      // a 200, distinct from a query that simply failed.
      expect(refused).toMatchObject({
        _tag: "CoachBotProvisioningRepo.ProvisioningUnavailable",
        reason: "not-found",
      })

      // The workspace still runs the bot the first tap installed.
      expect(yield* repo.findByWorkspace(aggregate.workspace.id)).toMatchObject({
        telegramBotId: "9100010",
        username: "ada_first_bot",
      })
      expect((yield* Effect.flip(repo.findByBotId("9100011")))._tag).toBe(
        "CoachBotProvisioningRepo.InstallationNotFound",
      )
      // And no attempt row was re-pointed at the second bot.
      const { client } = yield* Database.Service
      const attempts = yield* Effect.promise(() =>
        client
          .select({
            managedBotId: schema.coachBotProvisioning.managedBotId,
            status: schema.coachBotProvisioning.status,
          })
          .from(schema.coachBotProvisioning)
          .where(eq(schema.coachBotProvisioning.inviteId, aggregate.invite.id)),
      )
      expect(attempts).toEqual([{ managedBotId: "9100010", status: "completed" }])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("holds a managed bot as in flight only between its claim and activation", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const aggregate = yield* inviteFor("in-flight", ISSUED_AT)
      const botId = "9100013"
      const claimedAt = new Date("2026-07-23T19:10:00.000Z")

      // Nothing claimed yet: the bot is not ours to be waiting on.
      expect(yield* repo.findInFlightManagedAttempt(botId)).toBeUndefined()

      const prepared = yield* repo.prepare(aggregate.invite.id, coach, EN, STARTED_AT)
      expect(yield* repo.findInFlightManagedAttempt(botId)).toBeUndefined()

      // Claimed and configuring: this bot is ours and unfinished, which is what a
      // tripwire on its own route needs to tell from a bot id nobody has seen.
      yield* repo.claim(coach, botId, "ada_in_flight_bot", claimedAt)
      // The row itself, so the log can name the attempt and when it was touched.
      expect(yield* repo.findInFlightManagedAttempt(botId)).toEqual({
        id: prepared.id,
        updatedAt: claimedAt,
      })
      // Only that bot: another id is not in flight just because this one is.
      expect(yield* repo.findInFlightManagedAttempt("9100014")).toBeUndefined()

      yield* repo.complete({
        provisioningId: prepared.id,
        encryptedToken: "sealed:9100013:token",
        webhookSecretHash: "in-flight-hash",
        botInfo: { id: 9100013, is_bot: true, first_name: "Ada In Flight" },
        now: new Date("2026-07-23T19:11:00.000Z"),
      })
      // Activation committed, so the installation route serves it from here on.
      expect(yield* repo.findInFlightManagedAttempt(botId)).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("names the invitation's own lifecycle when it refuses a claim", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const { client } = yield* Database.Service
      const aggregate = yield* inviteFor("claim-reset", ISSUED_AT)

      yield* repo.prepare(aggregate.invite.id, coach, EN, STARTED_AT)
      // An administrator resets the invitation between the `/start` and the tap.
      yield* Effect.promise(() =>
        client
          .update(schema.coachOnboardingInvite)
          .set({
            status: "cancelled",
            cancellationReason: "reset_by_admin",
            cancelledAt: ISSUED_AT,
          })
          .where(eq(schema.coachOnboardingInvite.id, aggregate.invite.id)),
      )

      const refused = yield* Effect.flip(
        repo.claim(coach, "9100012", "ada_reset_bot", new Date("2026-07-23T19:20:00.000Z")),
      )
      // Not `not-found`: this coach *does* hold an open attempt, so the bot they
      // just created is their first, not a spare. The webhook's terminal branch
      // would otherwise reassure them about a bot that was never connected.
      expect(refused).toMatchObject({
        _tag: "CoachBotProvisioningRepo.ProvisioningUnavailable",
        reason: "cancelled",
      })
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("activation installs the bot and leaves no proof material behind", () =>
    Effect.gen(function* () {
      const repo = yield* CoachBotProvisioningRepo.Service
      const onboarding = yield* CoachOnboardingRepo.Service
      const aggregate = yield* inviteFor("paste-activation", ISSUED_AT)

      yield* repo.prepare(aggregate.invite.id, coach, EN, STARTED_AT)
      yield* repo.ingestCandidate({
        coachTelegramId: coach,
        ...candidate,
        botId: "9100005",
        now: STARTED_AT,
      })
      // The proof handshake promotes the parked candidate through the very same
      // claim the one-tap path takes.
      const claimed = yield* repo.claim(coach, "9100005", candidate.botUsername, STARTED_AT)
      expect(claimed.status).toBe("configuring")

      // A configuration that failed halfway is retried by Telegram redelivering
      // the handshake, so the claim has to resume rather than refuse its own row.
      const resumed = yield* repo.claim(
        coach,
        "9100005",
        candidate.botUsername,
        new Date("2026-07-23T19:15:00.000Z"),
      )
      expect(resumed.id).toBe(claimed.id)
      expect(resumed.status).toBe("configuring")
      expect((yield* repo.findCandidateByBotId("9100005")).status).toBe("configuring")

      const installation = yield* repo.complete({
        provisioningId: claimed.id,
        encryptedToken: candidate.encryptedToken,
        webhookSecretHash: candidate.webhookSecretHash,
        botInfo: { id: 9100005, is_bot: true, username: candidate.botUsername },
        now: STARTED_AT,
      })
      expect(installation).toMatchObject({
        workspaceId: aggregate.workspace.id,
        telegramBotId: "9100005",
        username: candidate.botUsername,
      })
      expect((yield* onboarding.findInvite(aggregate.invite.id)).invite.status).toBe("used")
      expect((yield* Effect.flip(repo.findCandidateByBotId("9100005")))._tag).toBe(
        "CoachBotProvisioningRepo.CandidateNotFound",
      )

      // The regression net for the notification key change (#54). Activation's
      // enqueue infers its `on conflict` target from a unique index, so the
      // moment `coach_bot_notification_workspace_id_idx` was dropped this
      // statement either matches `dedupe_key` or raises 42P10 and takes the
      // whole activation — bot row, owner binding, invite consumption — with it.
      const { client } = yield* Database.Service
      const queued = yield* Effect.promise(() =>
        client
          .select({
            id: schema.coachBotNotification.id,
            kind: schema.coachBotNotification.kind,
            dedupeKey: schema.coachBotNotification.dedupeKey,
            recipientTelegramId: schema.coachBotNotification.recipientTelegramId,
          })
          .from(schema.coachBotNotification)
          .where(eq(schema.coachBotNotification.workspaceId, aggregate.workspace.id)),
      )
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({
        kind: "bot_connected",
        dedupeKey: `bot_connected:${aggregate.workspace.id}`,
        recipientTelegramId: issuedByTelegramId,
      })

      // A redelivered activation must stay a no-op rather than a duplicate push.
      yield* repo.complete({
        provisioningId: claimed.id,
        encryptedToken: candidate.encryptedToken,
        webhookSecretHash: candidate.webhookSecretHash,
        botInfo: { id: 9100005, is_bot: true, username: candidate.botUsername },
        now: STARTED_AT,
      })
      const afterRetry = yield* Effect.promise(() =>
        client
          .select({ id: schema.coachBotNotification.id })
          .from(schema.coachBotNotification)
          .where(eq(schema.coachBotNotification.workspaceId, aggregate.workspace.id)),
      )
      expect(afterRetry).toHaveLength(1)

      const pending = yield* repo.pendingNotifications(STARTED_AT, 10)
      expect(
        pending.filter((notification) => notification.workspaceId === aggregate.workspace.id),
      ).toMatchObject([{ kind: "bot_connected" }])
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )
})
