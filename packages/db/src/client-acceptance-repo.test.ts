import { describe, expect, it } from "@effect/vitest"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { ClientAcceptanceRepo } from "./client-acceptance-repo.ts"
import { Database } from "./client.ts"
import * as schema from "./schema.ts"
import { skipWithoutDatabase, testDatabaseUrl } from "./test-database.ts"

const uid = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12)

const NOW = new Date("2026-07-26T09:00:00.000Z")
const EXPIRES_AT = new Date("2026-08-02T09:00:00.000Z")
const CONSENT_VERSION = "2026-08-01+ru+aaaaaaa"

interface Fixture {
  readonly workspaceId: string
  readonly clientId: string
  readonly inviteId: string
  readonly telegramBotId: string
  readonly coachTelegramId: string
  readonly token: string
  readonly suffix: string
}

/**
 * Acceptance is the one write in this slice that has to be all-or-nothing: the
 * Channel, the Consent Grant, the client's language, the profile snapshot and
 * the coach's notification land together or the client is told to try again.
 * Only a real Postgres can say whether the statement below actually does that.
 */
describe.skipIf(skipWithoutDatabase)("ClientAcceptanceRepo (dev Neon branch)", () => {
  const appLayer = Layer.provideMerge(
    ClientAcceptanceRepo.layer,
    Database.testLayer(testDatabaseUrl),
  )

  const fixture = Effect.fnUntraced(function* (options: { readonly expired?: boolean } = {}) {
    const { client } = yield* Database.Service
    const suffix = uid()
    const made: Fixture = {
      workspaceId: `ws_acc_${suffix}`,
      clientId: `cl_acc_${suffix}`,
      inviteId: `iv_acc_${suffix}`,
      telegramBotId: `92${suffix.slice(0, 8)}`,
      coachTelegramId: `72${suffix.slice(0, 8)}`,
      token: `T${suffix.slice(0, 11).toUpperCase()}`,
      suffix,
    }

    yield* Effect.promise(() =>
      client.insert(schema.workspace).values({ id: made.workspaceId, name: "Ada Coaching" }),
    )
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        client.delete(schema.workspace).where(eq(schema.workspace.id, made.workspaceId)),
      ).pipe(Effect.asVoid),
    )
    yield* Effect.promise(() =>
      client.insert(schema.member).values({
        id: `me_acc_${suffix}`,
        workspaceId: made.workspaceId,
        role: "owner",
        language: "en",
        telegramUserId: made.coachTelegramId,
        timezone: "Europe/Kyiv",
      }),
    )
    yield* Effect.promise(() =>
      client.insert(schema.bot).values({
        workspaceId: made.workspaceId,
        telegramBotId: made.telegramBotId,
        username: `praximo_${suffix}_bot`,
        connectionStatus: "connected",
      }),
    )
    yield* Effect.promise(() =>
      client
        .insert(schema.client)
        .values({ id: made.clientId, workspaceId: made.workspaceId, name: "Maria K." }),
    )
    yield* Effect.promise(() =>
      client.insert(schema.invite).values({
        id: made.inviteId,
        workspaceId: made.workspaceId,
        clientId: made.clientId,
        token: made.token,
        status: "pending",
        delivery: { kind: "telegram", language: "uk" },
        expiresAt: options.expired === true ? new Date("2026-07-01T09:00:00.000Z") : EXPIRES_AT,
      }),
    )
    return made
  })

  const accept = (made: Fixture, telegramUserId: string, label: string) =>
    Effect.gen(function* () {
      const repo = yield* ClientAcceptanceRepo.Service
      return yield* repo.accept({
        inviteId: made.inviteId,
        workspaceId: made.workspaceId,
        clientId: made.clientId,
        telegramUserId,
        telegramName: "Maria",
        telegramUsername: "maria",
        language: "ru",
        consentTextVersion: CONSENT_VERSION,
        channelId: `ch_${label}_${made.suffix}`,
        consentId: `cg_${label}_${made.suffix}`,
        now: NOW,
      })
    })

  it.effect("resolves a token only inside the workspace of the bot it was shown to", () =>
    Effect.gen(function* () {
      const repo = yield* ClientAcceptanceRepo.Service
      const made = yield* fixture()
      const other = yield* fixture()

      const own = yield* repo.findByToken(made.token, made.telegramBotId)
      expect(own?.clientName).toBe("Maria K.")
      expect(own?.status).toBe("pending")
      expect(own?.coachName).toBe("Ada Coaching")

      // The same token presented to another coach's bot discloses nothing — it
      // is answered exactly like an unrecognized `/start`.
      expect(yield* repo.findByToken(made.token, other.telegramBotId)).toBeUndefined()
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("lands the channel, the consent, the language and the coach's push together", () =>
    Effect.gen(function* () {
      const { client } = yield* Database.Service
      const made = yield* fixture()

      expect(yield* accept(made, "810000123", "first")).toEqual({ accepted: true })

      const invites = yield* Effect.promise(() =>
        client.select().from(schema.invite).where(eq(schema.invite.id, made.inviteId)),
      )
      const channels = yield* Effect.promise(() =>
        client.select().from(schema.channel).where(eq(schema.channel.clientId, made.clientId)),
      )
      const consents = yield* Effect.promise(() =>
        client
          .select()
          .from(schema.consentGrant)
          .where(eq(schema.consentGrant.clientId, made.clientId)),
      )
      const clients = yield* Effect.promise(() =>
        client.select().from(schema.client).where(eq(schema.client.id, made.clientId)),
      )
      const pushes = yield* Effect.promise(() =>
        client
          .select()
          .from(schema.coachBotNotification)
          .where(eq(schema.coachBotNotification.workspaceId, made.workspaceId)),
      )

      expect(invites[0]?.status).toBe("accepted")
      expect(channels).toHaveLength(1)
      expect(channels[0]?.address).toBe("810000123")
      expect(channels[0]?.telegramSnapshot).toEqual({ name: "Maria", username: "maria" })
      expect(consents[0]?.textVersion).toBe(CONSENT_VERSION)
      expect(clients[0]?.language).toBe("ru")
      expect(pushes).toHaveLength(1)
      expect(pushes[0]?.recipientTelegramId).toBe(made.coachTelegramId)
      expect(pushes[0]?.recipientRole).toBe("coach")
    }).pipe(Effect.provide(appLayer)),
  )

  // A double tap on the same button: the second statement updates nothing, and
  // because everything else selects from that update, nothing else runs either.
  it.effect("creates nothing twice when the same tap arrives again", () =>
    Effect.gen(function* () {
      const { client } = yield* Database.Service
      const made = yield* fixture()

      expect(yield* accept(made, "810000123", "first")).toEqual({ accepted: true })
      expect(yield* accept(made, "810000123", "second")).toEqual({ accepted: false })

      const channels = yield* Effect.promise(() =>
        client.select().from(schema.channel).where(eq(schema.channel.clientId, made.clientId)),
      )
      const consents = yield* Effect.promise(() =>
        client
          .select()
          .from(schema.consentGrant)
          .where(eq(schema.consentGrant.clientId, made.clientId)),
      )
      expect(channels).toHaveLength(1)
      expect(consents).toHaveLength(1)
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("tells apart the client who came back from the stranger who followed the link", () =>
    Effect.gen(function* () {
      const repo = yield* ClientAcceptanceRepo.Service
      const made = yield* fixture()
      yield* accept(made, "810000123", "first")

      const lookup = yield* repo.findByToken(made.token, made.telegramBotId)
      expect(lookup?.status).toBe("accepted")
      expect(lookup?.acceptedByTelegramId).toBe("810000123")
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("reports an invitation whose window has closed", () =>
    Effect.gen(function* () {
      const repo = yield* ClientAcceptanceRepo.Service
      const made = yield* fixture({ expired: true })

      const lookup = yield* repo.findByToken(made.token, made.telegramBotId)
      expect(lookup?.status).toBe("pending")
      expect(lookup?.expiresAt.getTime()).toBeLessThan(NOW.getTime())
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("carries the first session and the coach's zone for the confirmation", () =>
    Effect.gen(function* () {
      const { client } = yield* Database.Service
      const repo = yield* ClientAcceptanceRepo.Service
      const made = yield* fixture()
      yield* Effect.promise(() =>
        client.insert(schema.session).values({
          id: `se_acc_${made.suffix}`,
          workspaceId: made.workspaceId,
          clientId: made.clientId,
          scheduledAt: new Date("2026-08-03T07:00:00.000Z"),
          durationMinutes: 30,
          kind: "intake",
        }),
      )

      const lookup = yield* repo.findByToken(made.token, made.telegramBotId)
      expect(lookup?.nextSession).toEqual({
        scheduledAt: new Date("2026-08-03T07:00:00.000Z"),
        durationMinutes: 30,
        kind: "intake",
      })
      expect(lookup?.coachTimezone).toBe("Europe/Kyiv")
    }).pipe(Effect.provide(appLayer)),
  )
})
