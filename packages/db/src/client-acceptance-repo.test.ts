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
const CONSENT_VERSION = "2026-08-01+ru+d68f379"

interface Fixture {
  readonly workspaceId: string
  readonly clientId: string
  readonly inviteId: string
  readonly telegramBotId: string
  readonly coachTelegramId: string
  readonly token: string
  readonly suffix: string
}

const telegramIdentity = (userId = "810000123"): ClientAcceptanceRepo.ClaimIdentity => ({
  kind: "telegram",
  userId,
  name: "Maria",
  username: "maria",
})

const emailIdentity = (
  overrides: { readonly googleSub?: string } = {},
): ClientAcceptanceRepo.ClaimIdentity => ({
  kind: "email",
  address: "maria@example.com",
  clientName: "Марія",
  ...overrides,
})

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

  const fixture = Effect.fnUntraced(function* (
    options: { readonly expired?: boolean; readonly withoutBot?: boolean } = {},
  ) {
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
    if (options.withoutBot !== true) {
      yield* Effect.promise(() =>
        client.insert(schema.bot).values({
          workspaceId: made.workspaceId,
          telegramBotId: made.telegramBotId,
          username: `praximo_${suffix}_bot`,
          connectionStatus: "connected",
        }),
      )
    }
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

  const claim = (made: Fixture, identity: ClientAcceptanceRepo.ClaimIdentity) =>
    Effect.gen(function* () {
      const repo = yield* ClientAcceptanceRepo.Service
      return yield* repo.claim({
        inviteId: made.inviteId,
        workspaceId: made.workspaceId,
        clientId: made.clientId,
        identity,
        language: "ru",
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

  const identities = [
    {
      label: "Telegram identity",
      identity: telegramIdentity(),
      expected: {
        kind: "telegram",
        address: "810000123",
        snapshot: { name: "Maria", username: "maria" },
      },
    },
    {
      label: "email identity",
      identity: emailIdentity(),
      expected: {
        kind: "email",
        address: "maria@example.com",
        snapshot: { name: "Марія" },
      },
    },
  ] as const

  for (const identityCase of identities) {
    describe(identityCase.label, () => {
      it.effect("lands the Channel, Consent Grant, language and coach push together", () =>
        Effect.gen(function* () {
          const { client } = yield* Database.Service
          const made = yield* fixture()

          expect(yield* claim(made, identityCase.identity)).toEqual({ accepted: true })

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
          expect(channels[0]?.id).toMatch(/^ch_[0-9a-f]{20}$/)
          expect(channels[0]?.kind).toBe(identityCase.expected.kind)
          expect(channels[0]?.address).toBe(identityCase.expected.address)
          expect(channels[0]?.isPrimary).toBe(true)
          expect(channels[0]?.snapshot).toEqual(identityCase.expected.snapshot)
          expect(consents).toHaveLength(1)
          expect(consents[0]?.id).toMatch(/^cg_[0-9a-f]{20}$/)
          expect(consents[0]?.textVersion).toBe(CONSENT_VERSION)
          expect(consents[0]?.channelKind).toBe(identityCase.expected.kind)
          expect(clients[0]?.language).toBe("ru")
          expect(clients[0]?.name).toBe("Maria K.")
          expect(clients[0]?.googleSub).toBeNull()
          expect(pushes).toHaveLength(1)
          expect(pushes[0]?.recipientTelegramId).toBe(made.coachTelegramId)
          expect(pushes[0]?.recipientRole).toBe("coach")
        }).pipe(Effect.provide(appLayer)),
      )

      it.effect("creates nothing twice when the same claim arrives again", () =>
        Effect.gen(function* () {
          const { client } = yield* Database.Service
          const made = yield* fixture()

          expect(yield* claim(made, identityCase.identity)).toEqual({ accepted: true })
          expect(yield* claim(made, identityCase.identity)).toEqual({ accepted: false })

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
    })
  }

  it.effect("tells apart the client who came back from the stranger who followed the link", () =>
    Effect.gen(function* () {
      const repo = yield* ClientAcceptanceRepo.Service
      const made = yield* fixture()
      yield* claim(made, telegramIdentity())

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

  /** The web lookup stays distinct: unlike `claim`, it has no Bot id to scope by. */
  describe("the web door", () => {
    it.effect("resolves a token with no bot in the picture at all", () =>
      Effect.gen(function* () {
        const repo = yield* ClientAcceptanceRepo.Service
        // No bot row: a client who is not on Telegram may belong to a coach whose
        // bot is not connected yet, and the link they were handed still has to
        // open. This is the whole reason the bot id cannot be a join condition
        // here — and the token is globally unique, so nothing is lost by it.
        const made = yield* fixture({ withoutBot: true })

        const lookup = yield* repo.findByWebToken(made.token)
        expect(lookup?.clientName).toBe("Maria K.")
        expect(lookup?.coachName).toBe("Ada Coaching")
        expect(lookup?.status).toBe("pending")
        expect(lookup?.inviteLanguage).toBe("uk")
      }).pipe(Effect.provide(appLayer)),
    )

    it.effect("discloses nothing for a token nobody issued", () =>
      Effect.gen(function* () {
        const repo = yield* ClientAcceptanceRepo.Service
        expect(yield* repo.findByWebToken("ZZZZZZZZZZZZ")).toBeUndefined()
      }).pipe(Effect.provide(appLayer)),
    )

    it.effect("records a Google subject only when one was actually supplied", () =>
      Effect.gen(function* () {
        const { client } = yield* Database.Service
        const made = yield* fixture()

        yield* claim(made, emailIdentity({ googleSub: "108120977000" }))

        const clients = yield* Effect.promise(() =>
          client.select().from(schema.client).where(eq(schema.client.id, made.clientId)),
        )
        expect(clients[0]?.googleSub).toBe("108120977000")
      }).pipe(Effect.provide(appLayer)),
    )

    // A link already walked through on Telegram cannot be walked through again on
    // the web, and the reverse: one invite, one door, whichever it turns out to be.
    it.effect("refuses a token the Telegram door already spent", () =>
      Effect.gen(function* () {
        const repo = yield* ClientAcceptanceRepo.Service
        const made = yield* fixture()
        yield* claim(made, telegramIdentity())

        expect(yield* claim(made, emailIdentity())).toEqual({ accepted: false })
        expect((yield* repo.findByWebToken(made.token))?.status).toBe("accepted")
      }).pipe(Effect.provide(appLayer)),
    )
  })
})
