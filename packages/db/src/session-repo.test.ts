import { describe, expect, it } from "@effect/vitest"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "./client.ts"
import * as schema from "./schema.ts"
import { SessionRepo } from "./session-repo.ts"
import { skipWithoutDatabase, testDatabaseUrl } from "./test-database.ts"

const uid = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12)

const NOW = new Date("2026-07-26T09:00:00.000Z")
/** Monday 27 July, 10:00 UTC. */
const MONDAY_TEN = new Date("2026-07-27T10:00:00.000Z")

interface Fixture {
  readonly workspaceId: string
  readonly clientId: string
  readonly otherClientId: string
  readonly suffix: string
}

/**
 * Scheduling is refused by the *statement*, not by a read followed by an
 * insert: two coaches — or one coach on two devices — booking the same slot is
 * exactly the race a check-then-write loses, and `web-room-sessions.md` forbids
 * overlapping sessions within a workspace outright.
 */
describe.skipIf(skipWithoutDatabase)("SessionRepo (dev Neon branch)", () => {
  const appLayer = Layer.provideMerge(SessionRepo.layer, Database.testLayer(testDatabaseUrl))

  const fixture = Effect.fnUntraced(function* () {
    const { client } = yield* Database.Service
    const suffix = uid()
    const made: Fixture = {
      workspaceId: `ws_ses_${suffix}`,
      clientId: `cl_ses_${suffix}`,
      otherClientId: `cl_oth_${suffix}`,
      suffix,
    }

    yield* Effect.promise(() =>
      client.insert(schema.workspace).values({ id: made.workspaceId, name: "Session Repo" }),
    )
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        client.delete(schema.workspace).where(eq(schema.workspace.id, made.workspaceId)),
      ).pipe(Effect.asVoid),
    )
    yield* Effect.promise(() =>
      client.insert(schema.client).values([
        { id: made.clientId, workspaceId: made.workspaceId, name: "Maria K." },
        { id: made.otherClientId, workspaceId: made.workspaceId, name: "Anna P." },
      ]),
    )
    return made
  })

  const schedule = (
    made: Fixture,
    options: {
      readonly sessionId: string
      readonly scheduledAt: Date
      readonly durationMinutes?: number
      readonly clientId?: string
    },
  ) =>
    Effect.gen(function* () {
      const repo = yield* SessionRepo.Service
      return yield* repo.schedule({
        workspaceId: made.workspaceId,
        clientId: options.clientId ?? made.clientId,
        sessionId: options.sessionId,
        scheduledAt: options.scheduledAt,
        durationMinutes: options.durationMinutes ?? 30,
        kind: "intake",
        now: NOW,
      })
    })

  it.effect("schedules a session for a client of this workspace", () =>
    Effect.gen(function* () {
      const made = yield* fixture()

      const outcome = yield* schedule(made, {
        sessionId: `se_ok_${made.suffix}`,
        scheduledAt: MONDAY_TEN,
      })

      expect(outcome).toEqual({ scheduled: true })
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("refuses a start that runs into a session already booked", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      yield* schedule(made, {
        sessionId: `se_first_${made.suffix}`,
        scheduledAt: MONDAY_TEN,
        durationMinutes: 60,
      })

      // 10:45 + 30 lands inside 10:00–11:00, and the other client makes no
      // difference: the coach cannot be in two rooms at once.
      const clash = yield* schedule(made, {
        sessionId: `se_clash_${made.suffix}`,
        scheduledAt: new Date("2026-07-27T10:45:00.000Z"),
        clientId: made.otherClientId,
      })
      expect(clash).toEqual({ scheduled: false, reason: "overlap" })

      // Ending exactly where the next begins is not an overlap.
      const abutting = yield* schedule(made, {
        sessionId: `se_next_${made.suffix}`,
        scheduledAt: new Date("2026-07-27T11:00:00.000Z"),
      })
      expect(abutting).toEqual({ scheduled: true })
    }).pipe(Effect.provide(appLayer)),
  )

  // A cancelled session releases its slot; only the live ones hold one.
  it.effect("ignores a cancelled session when it checks for an overlap", () =>
    Effect.gen(function* () {
      const { client } = yield* Database.Service
      const made = yield* fixture()
      yield* schedule(made, {
        sessionId: `se_cancelled_${made.suffix}`,
        scheduledAt: MONDAY_TEN,
        durationMinutes: 60,
      })
      yield* Effect.promise(() =>
        client
          .update(schema.session)
          .set({ state: "cancelled", cancelReason: "coach_cancelled" })
          .where(eq(schema.session.id, `se_cancelled_${made.suffix}`)),
      )

      expect(
        yield* schedule(made, {
          sessionId: `se_reuse_${made.suffix}`,
          scheduledAt: MONDAY_TEN,
        }),
      ).toEqual({ scheduled: true })
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("refuses a client that is not this workspace's", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      const other = yield* fixture()

      expect(
        yield* schedule(made, {
          sessionId: `se_tenant_${made.suffix}`,
          scheduledAt: MONDAY_TEN,
          clientId: other.clientId,
        }),
      ).toEqual({ scheduled: false, reason: "unknown-client" })
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("reports the day's sessions as the busy intervals the grid dims", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      yield* schedule(made, {
        sessionId: `se_day_${made.suffix}`,
        scheduledAt: MONDAY_TEN,
        durationMinutes: 60,
      })
      // The day before is not this day's business.
      yield* schedule(made, {
        sessionId: `se_before_${made.suffix}`,
        scheduledAt: new Date("2026-07-26T10:00:00.000Z"),
      })

      const busy = yield* SessionRepo.Service.pipe(
        Effect.flatMap((repo) =>
          repo.between(
            made.workspaceId,
            new Date("2026-07-27T00:00:00.000Z"),
            new Date("2026-07-28T00:00:00.000Z"),
          ),
        ),
      )

      expect(busy).toEqual([{ scheduledAt: MONDAY_TEN, durationMinutes: 60 }])
    }).pipe(Effect.provide(appLayer)),
  )
})
