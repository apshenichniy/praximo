import { describe, expect, it } from "@effect/vitest"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "./client.ts"
import { ClientRepo } from "./client-repo.ts"
import * as schema from "./schema.ts"
import { skipWithoutDatabase, testDatabaseUrl } from "./test-database.ts"

const uid = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12)

const NOW = new Date("2026-07-26T09:00:00.000Z")
const EXPIRES_AT = new Date("2026-08-02T09:00:00.000Z")

interface Fixture {
  readonly workspaceId: string
  readonly suffix: string
}

/**
 * Client creation, the list, the detail read, deletion and reissue — every one
 * of them a statement whose correctness *is* what Postgres allows: an atomic
 * two-row insert, a conditional delete, and a reissue that expires its
 * predecessor. None of that survives being tested against a fake.
 */
describe.skipIf(skipWithoutDatabase)("ClientRepo (dev Neon branch)", () => {
  const appLayer = Layer.provideMerge(ClientRepo.layer, Database.testLayer(testDatabaseUrl))

  const workspaceFixture = Effect.fnUntraced(function* () {
    const { client } = yield* Database.Service
    const suffix = uid()
    const fixture: Fixture = { workspaceId: `ws_cli_${suffix}`, suffix }

    yield* Effect.promise(() =>
      client.insert(schema.workspace).values({ id: fixture.workspaceId, name: "Client Repo" }),
    )
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        client.delete(schema.workspace).where(eq(schema.workspace.id, fixture.workspaceId)),
      ).pipe(Effect.asVoid),
    )
    return fixture
  })

  const create = (fixture: Fixture, label: string, now = NOW) =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const clientId = `cl_${label}_${fixture.suffix}`
      yield* repo.createWithInvite({
        workspaceId: fixture.workspaceId,
        clientId,
        inviteId: `inv_${label}_${fixture.suffix}`,
        name: `Client ${label}`,
        token: `TOK${label.toUpperCase()}${fixture.suffix.slice(0, 6).toUpperCase()}`,
        inviteLanguage: "uk",
        now,
        expiresAt: EXPIRES_AT,
      })
      return clientId
    })

  it.effect("creates the client and its invitation in one statement", () =>
    Effect.gen(function* () {
      const { client } = yield* Database.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "one")

      const clients = yield* Effect.promise(() =>
        client.select().from(schema.client).where(eq(schema.client.id, clientId)),
      )
      const invites = yield* Effect.promise(() =>
        client.select().from(schema.invite).where(eq(schema.invite.clientId, clientId)),
      )

      expect(clients).toHaveLength(1)
      expect(invites).toHaveLength(1)
      // The invitation's language is the language of the *message*, recorded on
      // delivery so #57 can write the email in it. The client's own language is
      // still unknown — they pick it when they accept.
      expect(invites[0]?.delivery).toEqual({ kind: "telegram", language: "uk" })
      expect(clients[0]?.language).toBeNull()
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("lists clients with the state the home screen colours", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const { client } = yield* Database.Service
      const fixture = yield* workspaceFixture()

      const pending = yield* create(fixture, "pending")
      const lapsed = yield* create(fixture, "lapsed")
      const accepted = yield* create(fixture, "accepted")

      // A window that closed: expiry stays derived at read time, so nothing had
      // to write `expired` for the list to say so.
      yield* Effect.promise(() =>
        client
          .update(schema.invite)
          .set({ expiresAt: new Date("2026-07-20T09:00:00.000Z") })
          .where(eq(schema.invite.clientId, lapsed)),
      )
      yield* Effect.promise(() =>
        client
          .update(schema.invite)
          .set({ status: "accepted" })
          .where(eq(schema.invite.clientId, accepted)),
      )
      yield* Effect.promise(() =>
        client.insert(schema.channel).values({
          id: `ch_${fixture.suffix}`,
          clientId: accepted,
          kind: "telegram",
          address: "810000001",
          isPrimary: true,
        }),
      )

      const rows = yield* repo.list(fixture.workspaceId, NOW)
      const state = (id: string) => rows.find((row) => row.id === id)?.state

      expect(state(pending)).toBe("invited")
      expect(state(lapsed)).toBe("expired")
      expect(state(accepted)).toBe("accepted")
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("reads one client with everything the route shows", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "detail")

      const detail = yield* repo.find(fixture.workspaceId, clientId, NOW)

      expect(detail?.name).toBe("Client detail")
      expect(detail?.invite?.status).toBe("pending")
      expect(detail?.invite?.language).toBe("uk")
      // Nothing has been recorded yet, so "undo the creation" is still available.
      expect(detail?.canDelete).toBe(true)
    }).pipe(Effect.provide(appLayer)),
  )

  // Tenancy is not a filter the caller may forget: another workspace's id must
  // read as "no such client" rather than as somebody else's.
  it.effect("refuses to read a client from another workspace", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const one = yield* workspaceFixture()
      const other = yield* workspaceFixture()
      const clientId = yield* create(one, "tenant")

      expect(yield* repo.find(other.workspaceId, clientId, NOW)).toBeUndefined()
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("deletes a client while nothing has been recorded", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "gone")

      expect(yield* repo.deleteUnaccepted(fixture.workspaceId, clientId)).toEqual({ deleted: true })
      expect(yield* repo.find(fixture.workspaceId, clientId, NOW)).toBeUndefined()
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("refuses to delete once a session or an acceptance exists", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const { client } = yield* Database.Service
      const fixture = yield* workspaceFixture()

      const scheduled = yield* create(fixture, "scheduled")
      yield* Effect.promise(() =>
        client.insert(schema.session).values({
          id: `se_${fixture.suffix}`,
          workspaceId: fixture.workspaceId,
          clientId: scheduled,
          scheduledAt: new Date("2026-07-27T07:00:00.000Z"),
          durationMinutes: 30,
          kind: "intake",
        }),
      )

      const joined = yield* create(fixture, "joined")
      yield* Effect.promise(() =>
        client
          .update(schema.invite)
          .set({ status: "accepted" })
          .where(eq(schema.invite.clientId, joined)),
      )

      expect(yield* repo.deleteUnaccepted(fixture.workspaceId, scheduled)).toEqual({
        deleted: false,
      })
      expect(yield* repo.deleteUnaccepted(fixture.workspaceId, joined)).toEqual({ deleted: false })
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("reissues an invitation and expires the one it replaces", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const { client } = yield* Database.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "reissue")

      const reissued = yield* repo.reissueInvite({
        workspaceId: fixture.workspaceId,
        clientId,
        inviteId: `inv_fresh_${fixture.suffix}`,
        token: `FRESH${fixture.suffix.slice(0, 7).toUpperCase()}`,
        inviteLanguage: "en",
        now: NOW,
        expiresAt: EXPIRES_AT,
      })

      const invites = yield* Effect.promise(() =>
        client.select().from(schema.invite).where(eq(schema.invite.clientId, clientId)),
      )
      const statuses = new Set(invites.map((row) => row.status))

      expect(reissued?.token).toBe(`FRESH${fixture.suffix.slice(0, 7).toUpperCase()}`)
      // `expired` is written by exactly one thing, and this is it.
      expect(invites).toHaveLength(2)
      expect(statuses).toEqual(new Set(["expired", "pending"]))
    }).pipe(Effect.provide(appLayer)),
  )

  /**
   * Delivery becomes a record rather than a guess (#224).
   *
   * The three things this statement has to get right at once: the moment lands,
   * the door lands beside it, and `delivery.language` survives — #57's
   * Acceptance Page reads that key to pre-select the language the consent is
   * granted in, and a merge written as a replace would silently break it.
   */
  it.effect("records the moment and the door an invitation was handed over", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const { client } = yield* Database.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "handed")

      const before = yield* repo.find(fixture.workspaceId, clientId, NOW)
      expect(before?.invite?.delivered).toBeUndefined()

      expect(
        yield* repo.recordDelivery({
          workspaceId: fixture.workspaceId,
          clientId,
          kind: "link",
          now: NOW,
        }),
      ).toEqual({ recorded: true })

      const invites = yield* Effect.promise(() =>
        client.select().from(schema.invite).where(eq(schema.invite.clientId, clientId)),
      )
      expect(invites[0]?.deliveredAt).toEqual(NOW)
      expect(invites[0]?.delivery).toEqual({ kind: "link", language: "uk" })

      const after = yield* repo.find(fixture.workspaceId, clientId, NOW)
      expect(after?.invite?.delivered).toEqual({ at: NOW, kind: "link" })
    }).pipe(Effect.provide(appLayer)),
  )

  /**
   * The service-sent invitation writes down *where* it went (#58).
   *
   * The address is merged in beside the kind and the language, never over them:
   * `language` is what #57's Acceptance Page reads to pre-select the language
   * the consent is granted in, and a replace here would drop it silently.
   */
  it.effect("records the address an invitation was emailed to", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const { client } = yield* Database.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "mailed")

      yield* repo.recordDelivery({
        workspaceId: fixture.workspaceId,
        clientId,
        kind: "email",
        address: "anna@example.com",
        now: NOW,
      })

      const invites = yield* Effect.promise(() =>
        client.select().from(schema.invite).where(eq(schema.invite.clientId, clientId)),
      )
      expect(invites[0]?.delivery).toEqual({
        kind: "email",
        language: "uk",
        address: "anna@example.com",
      })

      const detail = yield* repo.find(fixture.workspaceId, clientId, NOW)
      expect(detail?.invite?.delivered).toEqual({ at: NOW, kind: "email" })
      expect(detail?.invite?.address).toBe("anna@example.com")
    }).pipe(Effect.provide(appLayer)),
  )

  /**
   * A hand-copied link after an email must not erase the address.
   *
   * The two facts answer different questions — which door the coach last used,
   * and what address we have on file for them — and the second is what
   * pre-fills the sheet the next time they send.
   */
  it.effect("keeps the address when a later delivery goes out through another door", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "thenlink")
      const later = new Date("2026-07-27T09:00:00.000Z")

      yield* repo.recordDelivery({
        workspaceId: fixture.workspaceId,
        clientId,
        kind: "email",
        address: "anna@example.com",
        now: NOW,
      })
      yield* repo.recordDelivery({
        workspaceId: fixture.workspaceId,
        clientId,
        kind: "link",
        now: later,
      })

      const detail = yield* repo.find(fixture.workspaceId, clientId, later)
      expect(detail?.invite?.delivered).toEqual({ at: later, kind: "link" })
      expect(detail?.invite?.address).toBe("anna@example.com")
    }).pipe(Effect.provide(appLayer)),
  )

  /**
   * The last delivery wins, and both columns move together.
   *
   * A pair that could disagree would let the screen say «отправлено ссылкой»
   * about a moment that was a Telegram send — the one thing the state word must
   * not do.
   */
  it.effect("moves the moment and the door together on a second delivery", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "twice")
      const later = new Date("2026-07-27T09:00:00.000Z")

      yield* repo.recordDelivery({
        workspaceId: fixture.workspaceId,
        clientId,
        kind: "telegram",
        now: NOW,
      })
      yield* repo.recordDelivery({
        workspaceId: fixture.workspaceId,
        clientId,
        kind: "link",
        now: later,
      })

      const detail = yield* repo.find(fixture.workspaceId, clientId, later)
      expect(detail?.invite?.delivered).toEqual({ at: later, kind: "link" })
    }).pipe(Effect.provide(appLayer)),
  )

  // Tenancy again, on a write this time: a client id from another workspace is
  // not a client, and nothing is stamped.
  it.effect("records nothing for a client of another workspace", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const one = yield* workspaceFixture()
      const other = yield* workspaceFixture()
      const clientId = yield* create(one, "fenced")

      expect(
        yield* repo.recordDelivery({
          workspaceId: other.workspaceId,
          clientId,
          kind: "link",
          now: NOW,
        }),
      ).toEqual({ recorded: false })
      expect((yield* repo.find(one.workspaceId, clientId, NOW))?.invite?.delivered).toBeUndefined()
    }).pipe(Effect.provide(appLayer)),
  )

  /**
   * A reissue mints a fresh invitation, so the record starts again at nothing —
   * which is exactly right: the link the client is holding is dead, and the new
   * one has not been sent.
   */
  it.effect("leaves a reissued invitation undelivered", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "again")

      // A day later, because a reissue is a second deliberate gesture: the read
      // below picks the newest invitation, and two rows minted in the same
      // millisecond would leave which one that is up to Postgres.
      const later = new Date("2026-07-27T09:00:00.000Z")

      yield* repo.recordDelivery({
        workspaceId: fixture.workspaceId,
        clientId,
        kind: "telegram",
        now: NOW,
      })
      yield* repo.reissueInvite({
        workspaceId: fixture.workspaceId,
        clientId,
        inviteId: `inv_next_${fixture.suffix}`,
        token: `NEXT${fixture.suffix.slice(0, 8).toUpperCase()}`,
        inviteLanguage: "uk",
        now: later,
        expiresAt: EXPIRES_AT,
      })

      expect(
        (yield* repo.find(fixture.workspaceId, clientId, later))?.invite?.delivered,
      ).toBeUndefined()
    }).pipe(Effect.provide(appLayer)),
  )

  /**
   * …but the address rides across the reissue (#58, and the spec's own «re-issue
   * copies the delivery target»).
   *
   * The delivery does not, and must not: the fresh link has been sent nowhere.
   * Carrying the address is what saves the coach retyping something they have
   * already given us; carrying the *kind* would be the screen claiming a send
   * that never happened.
   */
  it.effect("carries the address into a reissued invitation but not the delivery", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "carried")
      const later = new Date("2026-07-27T09:00:00.000Z")

      yield* repo.recordDelivery({
        workspaceId: fixture.workspaceId,
        clientId,
        kind: "email",
        address: "anna@example.com",
        now: NOW,
      })
      yield* repo.reissueInvite({
        workspaceId: fixture.workspaceId,
        clientId,
        inviteId: `inv_carry_${fixture.suffix}`,
        token: `CARRY${fixture.suffix.slice(0, 7).toUpperCase()}`,
        inviteLanguage: "uk",
        now: later,
        expiresAt: EXPIRES_AT,
      })

      const detail = yield* repo.find(fixture.workspaceId, clientId, later)
      expect(detail?.invite?.address).toBe("anna@example.com")
      expect(detail?.invite?.delivered).toBeUndefined()
      // The language is the reissue's own, and the kind is back to the creation
      // default — nothing about the new link claims to have travelled.
      expect(detail?.invite?.language).toBe("uk")
    }).pipe(Effect.provide(appLayer)),
  )

  /** A client who never got an email reissues into an invitation with no address. */
  it.effect("reissues without an address when there was never one", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "noaddr")
      const later = new Date("2026-07-27T09:00:00.000Z")

      yield* repo.reissueInvite({
        workspaceId: fixture.workspaceId,
        clientId,
        inviteId: `inv_fresh_${fixture.suffix}`,
        token: `NOADDR${fixture.suffix.slice(0, 6).toUpperCase()}`,
        inviteLanguage: "uk",
        now: later,
        expiresAt: EXPIRES_AT,
      })

      expect(
        (yield* repo.find(fixture.workspaceId, clientId, later))?.invite?.address,
      ).toBeUndefined()
    }).pipe(Effect.provide(appLayer)),
  )

  // Nothing left to hand over: the client walked through the door already, so
  // the invitation they used is not restamped by a stale screen.
  it.effect("records nothing once the invitation has been accepted", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const { client } = yield* Database.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "inalready")

      yield* Effect.promise(() =>
        client
          .update(schema.invite)
          .set({ status: "accepted" })
          .where(eq(schema.invite.clientId, clientId)),
      )

      expect(
        yield* repo.recordDelivery({
          workspaceId: fixture.workspaceId,
          clientId,
          kind: "link",
          now: NOW,
        }),
      ).toEqual({ recorded: false })
    }).pipe(Effect.provide(appLayer)),
  )

  // The list says the state word, and since #224 it needs the same two facts the
  // client's own screen does.
  it.effect("carries the delivery record into the list", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const fixture = yield* workspaceFixture()
      const sent = yield* create(fixture, "sent")
      const unsent = yield* create(fixture, "unsent")

      yield* repo.recordDelivery({
        workspaceId: fixture.workspaceId,
        clientId: sent,
        kind: "link",
        now: NOW,
      })

      const rows = yield* repo.list(fixture.workspaceId, NOW)
      expect(rows.find((row) => row.id === sent)?.delivered).toEqual({ at: NOW, kind: "link" })
      expect(rows.find((row) => row.id === unsent)?.delivered).toBeUndefined()
    }).pipe(Effect.provide(appLayer)),
  )

  // The mirror case the ticket keeps apart: an invitation already accepted is
  // not reissued at all. The client is in; a fresh link would only confuse them.
  it.effect("refuses to reissue once the client has accepted", () =>
    Effect.gen(function* () {
      const repo = yield* ClientRepo.Service
      const { client } = yield* Database.Service
      const fixture = yield* workspaceFixture()
      const clientId = yield* create(fixture, "settled")

      yield* Effect.promise(() =>
        client
          .update(schema.invite)
          .set({ status: "accepted" })
          .where(eq(schema.invite.clientId, clientId)),
      )

      expect(
        yield* repo.reissueInvite({
          workspaceId: fixture.workspaceId,
          clientId,
          inviteId: `inv_no_${fixture.suffix}`,
          token: `NOPE${fixture.suffix.slice(0, 8).toUpperCase()}`,
          inviteLanguage: "en",
          now: NOW,
          expiresAt: EXPIRES_AT,
        }),
      ).toBeUndefined()
    }).pipe(Effect.provide(appLayer)),
  )
})
