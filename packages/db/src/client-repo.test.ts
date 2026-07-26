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
