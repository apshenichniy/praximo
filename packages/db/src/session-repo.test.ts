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

/** The row as the database actually holds it, for the writes that change it. */
const stateOf = (sessionId: string) =>
  Effect.gen(function* () {
    const { client } = yield* Database.Service
    const rows = yield* Effect.promise(() =>
      client
        .select({
          state: schema.session.state,
          cancelReason: schema.session.cancelReason,
          scheduledAt: schema.session.scheduledAt,
          durationMinutes: schema.session.durationMinutes,
        })
        .from(schema.session)
        .where(eq(schema.session.id, sessionId)),
    )
    return rows[0]
  })

/** A state no operation in this repository writes — the reconciler's, or #42's. */
const forceState = (sessionId: string, state: "in_progress" | "cancelled" | "completed") =>
  Effect.gen(function* () {
    const { client } = yield* Database.Service
    yield* Effect.promise(() =>
      client.update(schema.session).set({ state }).where(eq(schema.session.id, sessionId)),
    )
  })

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

  /**
   * Today and the sessions list are the same query with and without a `to`
   * (#61), and both of them have to name the client — a row that said "10:00,
   * 60 min" and nothing else would be a row nobody can act on.
   */
  it.effect("lists live sessions in a window, earliest first, named by client", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      yield* schedule(made, {
        sessionId: `se_late_${made.suffix}`,
        scheduledAt: new Date("2026-07-27T16:00:00.000Z"),
      })
      yield* schedule(made, {
        sessionId: `se_early_${made.suffix}`,
        scheduledAt: MONDAY_TEN,
        clientId: made.otherClientId,
      })
      yield* schedule(made, {
        sessionId: `se_outside_${made.suffix}`,
        scheduledAt: new Date("2026-07-28T10:00:00.000Z"),
      })

      const repo = yield* SessionRepo.Service
      const day = yield* repo.scheduled({
        workspaceId: made.workspaceId,
        from: new Date("2026-07-27T00:00:00.000Z"),
        to: new Date("2026-07-28T00:00:00.000Z"),
        limit: 50,
      })

      expect(day.map((row) => [row.id, row.clientName])).toEqual([
        [`se_early_${made.suffix}`, "Anna P."],
        [`se_late_${made.suffix}`, "Maria K."],
      ])

      // Without `to` the same statement is the flat upcoming list.
      const ahead = yield* repo.scheduled({
        workspaceId: made.workspaceId,
        from: new Date("2026-07-27T00:00:00.000Z"),
        limit: 50,
      })
      expect(ahead).toHaveLength(3)
    }).pipe(Effect.provide(appLayer)),
  )

  /**
   * The one thing that can be wrong with an otherwise healthy session: the
   * client never accepted, so there is no Channel and no way to send them a
   * link. Its absence is what the screen reads.
   */
  it.effect("says whether the client ever accepted, from the channel's absence", () =>
    Effect.gen(function* () {
      const { client } = yield* Database.Service
      const made = yield* fixture()
      yield* schedule(made, { sessionId: `se_open_${made.suffix}`, scheduledAt: MONDAY_TEN })
      yield* Effect.promise(() =>
        client.insert(schema.channel).values({
          id: `ch_${made.suffix}`,
          clientId: made.clientId,
          kind: "telegram",
          address: "810000001",
          isPrimary: true,
        }),
      )
      yield* schedule(made, {
        sessionId: `se_pending_${made.suffix}`,
        scheduledAt: new Date("2026-07-27T14:00:00.000Z"),
        clientId: made.otherClientId,
      })

      const repo = yield* SessionRepo.Service
      const rows = yield* repo.scheduled({
        workspaceId: made.workspaceId,
        from: new Date("2026-07-27T00:00:00.000Z"),
        limit: 50,
      })

      expect(rows.map((row) => row.clientAccepted)).toEqual([true, false])
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("reads one session, and refuses another workspace's", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      const other = yield* fixture()
      yield* schedule(made, { sessionId: `se_one_${made.suffix}`, scheduledAt: MONDAY_TEN })

      const repo = yield* SessionRepo.Service
      const found = yield* repo.find(made.workspaceId, `se_one_${made.suffix}`)
      expect(found?.clientName).toBe("Maria K.")
      expect(found?.scheduledAt).toEqual(MONDAY_TEN)

      // The tenant key comes from authentication, and the repository is the
      // second fence: another workspace's session simply does not exist.
      expect(yield* repo.find(other.workspaceId, `se_one_${made.suffix}`)).toBeUndefined()
    }).pipe(Effect.provide(appLayer)),
  )

  /**
   * A cancelled session is still a session somebody can hold a link to, and the
   * screen that reads it should say what it is rather than 404 (#62 develops
   * that screen; this is the read it will build on).
   */
  it.effect("finds a session whatever state it is in", () =>
    Effect.gen(function* () {
      const { client } = yield* Database.Service
      const made = yield* fixture()
      yield* schedule(made, { sessionId: `se_gone_${made.suffix}`, scheduledAt: MONDAY_TEN })
      yield* Effect.promise(() =>
        client
          .update(schema.session)
          .set({ state: "cancelled", cancelReason: "coach_cancelled" })
          .where(eq(schema.session.id, `se_gone_${made.suffix}`)),
      )

      const repo = yield* SessionRepo.Service
      expect((yield* repo.find(made.workspaceId, `se_gone_${made.suffix}`))?.state).toBe(
        "cancelled",
      )
      // The listing query is the one that filters: a cancelled session holds no
      // slot and belongs on no upcoming list.
      expect(
        yield* repo.scheduled({
          workspaceId: made.workspaceId,
          from: new Date("2026-07-27T00:00:00.000Z"),
          limit: 50,
        }),
      ).toEqual([])
    }).pipe(Effect.provide(appLayer)),
  )

  /**
   * Reschedule and cancel (#62) — the two lifecycle transitions a coach writes.
   *
   * Both are one conditional `UPDATE` for the same reason `schedule` is one
   * `INSERT`: the gate has to be evaluated by the statement that writes, or a
   * second device slips between the read and the write.
   */
  it.effect("moves a session in place, keeping its identity", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      const sessionId = `se_move_${made.suffix}`
      yield* schedule(made, { sessionId, scheduledAt: MONDAY_TEN, durationMinutes: 30 })

      const repo = yield* SessionRepo.Service
      const moved = yield* repo.reschedule({
        workspaceId: made.workspaceId,
        sessionId,
        scheduledAt: new Date("2026-07-27T15:30:00.000Z"),
        durationMinutes: 60,
        now: NOW,
      })

      expect(moved).toEqual({ rescheduled: true })
      // The same row, so join links and everything else hanging off the id
      // survive — which is the whole reason this is an update (domain-model.md).
      expect(yield* stateOf(sessionId)).toMatchObject({
        state: "scheduled",
        scheduledAt: new Date("2026-07-27T15:30:00.000Z"),
        durationMinutes: 60,
      })
    }).pipe(Effect.provide(appLayer)),
  )

  /**
   * The session must not collide with *itself*. Without excluding its own row
   * the guard would refuse every move that stays inside the hour it already
   * holds — including moving it fifteen minutes later, which is the commonest
   * reschedule there is.
   */
  it.effect("excludes the session being moved from its own overlap check", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      const sessionId = `se_self_${made.suffix}`
      yield* schedule(made, { sessionId, scheduledAt: MONDAY_TEN, durationMinutes: 60 })

      const repo = yield* SessionRepo.Service
      expect(
        yield* repo.reschedule({
          workspaceId: made.workspaceId,
          sessionId,
          scheduledAt: new Date("2026-07-27T10:15:00.000Z"),
          durationMinutes: 60,
          now: NOW,
        }),
      ).toEqual({ rescheduled: true })

      // And staying exactly where it is is a legal no-op, not an overlap.
      expect(
        yield* repo.reschedule({
          workspaceId: made.workspaceId,
          sessionId,
          scheduledAt: new Date("2026-07-27T10:15:00.000Z"),
          durationMinutes: 60,
          now: NOW,
        }),
      ).toEqual({ rescheduled: true })
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("refuses a move into a slot another live session holds", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      const sessionId = `se_movable_${made.suffix}`
      yield* schedule(made, { sessionId, scheduledAt: MONDAY_TEN, durationMinutes: 30 })
      yield* schedule(made, {
        sessionId: `se_blocker_${made.suffix}`,
        scheduledAt: new Date("2026-07-27T14:00:00.000Z"),
        durationMinutes: 60,
        clientId: made.otherClientId,
      })

      const repo = yield* SessionRepo.Service
      expect(
        yield* repo.reschedule({
          workspaceId: made.workspaceId,
          sessionId,
          scheduledAt: new Date("2026-07-27T14:30:00.000Z"),
          durationMinutes: 30,
          now: NOW,
        }),
      ).toEqual({ rescheduled: false, reason: "overlap" })

      // Refused means untouched: the row still says where it was.
      expect(yield* stateOf(sessionId)).toMatchObject({ scheduledAt: MONDAY_TEN })
    }).pipe(Effect.provide(appLayer)),
  )

  /**
   * `gone` rather than `overlap`, and the difference matters to the screen: one
   * asks for another time, the other says the session moved on underneath the
   * coach and re-reads.
   */
  it.effect("refuses to move a session that is no longer scheduled", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      const repo = yield* SessionRepo.Service
      const move = (sessionId: string) =>
        repo.reschedule({
          workspaceId: made.workspaceId,
          sessionId,
          scheduledAt: new Date("2026-07-27T18:00:00.000Z"),
          durationMinutes: 30,
          now: NOW,
        })

      const cancelled = `se_dead_${made.suffix}`
      yield* schedule(made, { sessionId: cancelled, scheduledAt: MONDAY_TEN })
      yield* forceState(cancelled, "cancelled")
      expect(yield* move(cancelled)).toEqual({ rescheduled: false, reason: "gone" })

      const running = `se_live_${made.suffix}`
      yield* schedule(made, {
        sessionId: running,
        scheduledAt: new Date("2026-07-27T12:00:00.000Z"),
      })
      yield* forceState(running, "in_progress")
      expect(yield* move(running)).toEqual({ rescheduled: false, reason: "gone" })

      // A session that does not exist at all reads the same way.
      expect(yield* move(`se_absent_${made.suffix}`)).toEqual({
        rescheduled: false,
        reason: "gone",
      })
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("refuses to move another workspace's session", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      const other = yield* fixture()
      const sessionId = `se_theirs_${made.suffix}`
      yield* schedule(made, { sessionId, scheduledAt: MONDAY_TEN })

      const repo = yield* SessionRepo.Service
      expect(
        yield* repo.reschedule({
          workspaceId: other.workspaceId,
          sessionId,
          scheduledAt: new Date("2026-07-27T18:00:00.000Z"),
          durationMinutes: 30,
          now: NOW,
        }),
      ).toEqual({ rescheduled: false, reason: "gone" })
      expect(yield* stateOf(sessionId)).toMatchObject({ scheduledAt: MONDAY_TEN })
    }).pipe(Effect.provide(appLayer)),
  )

  it.effect("cancels a scheduled session with the coach's own reason", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      const sessionId = `se_off_${made.suffix}`
      yield* schedule(made, { sessionId, scheduledAt: MONDAY_TEN, durationMinutes: 60 })

      const repo = yield* SessionRepo.Service
      expect(yield* repo.cancel(made.workspaceId, sessionId, NOW)).toEqual({ cancelled: true })
      expect(yield* stateOf(sessionId)).toMatchObject({
        state: "cancelled",
        cancelReason: "coach_cancelled",
      })

      // And the slot is free again: a cancelled session holds nothing.
      expect(
        yield* schedule(made, {
          sessionId: `se_reclaim_${made.suffix}`,
          scheduledAt: MONDAY_TEN,
          durationMinutes: 60,
        }),
      ).toEqual({ scheduled: true })
    }).pipe(Effect.provide(appLayer)),
  )

  /**
   * `in_progress` is the reconciler's (ADR 0005): ending a session that is
   * running is `coach_end` and a close reason, not a cancellation, and #42 owns
   * it. A second cancel is refused for the same reason — the row already left.
   */
  it.effect("cancels only a scheduled session, and only in this workspace", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      const other = yield* fixture()
      const repo = yield* SessionRepo.Service

      const running = `se_running_${made.suffix}`
      yield* schedule(made, { sessionId: running, scheduledAt: MONDAY_TEN })
      yield* forceState(running, "in_progress")
      expect(yield* repo.cancel(made.workspaceId, running, NOW)).toEqual({ cancelled: false })

      const twice = `se_twice_${made.suffix}`
      yield* schedule(made, {
        sessionId: twice,
        scheduledAt: new Date("2026-07-27T12:00:00.000Z"),
      })
      expect(yield* repo.cancel(made.workspaceId, twice, NOW)).toEqual({ cancelled: true })
      expect(yield* repo.cancel(made.workspaceId, twice, NOW)).toEqual({ cancelled: false })

      const theirs = `se_guarded_${made.suffix}`
      yield* schedule(made, {
        sessionId: theirs,
        scheduledAt: new Date("2026-07-27T14:00:00.000Z"),
      })
      expect(yield* repo.cancel(other.workspaceId, theirs, NOW)).toEqual({ cancelled: false })
      expect(yield* stateOf(theirs)).toMatchObject({ state: "scheduled" })
    }).pipe(Effect.provide(appLayer)),
  )

  /** The reason travels with the row, so the screen can say what happened. */
  it.effect("reads a cancelled session back with its reason", () =>
    Effect.gen(function* () {
      const made = yield* fixture()
      const sessionId = `se_reason_${made.suffix}`
      yield* schedule(made, { sessionId, scheduledAt: MONDAY_TEN })

      const repo = yield* SessionRepo.Service
      yield* repo.cancel(made.workspaceId, sessionId, NOW)

      const found = yield* repo.find(made.workspaceId, sessionId)
      expect(found?.state).toBe("cancelled")
      expect(found?.cancelReason).toBe("coach_cancelled")
    }).pipe(Effect.provide(appLayer)),
  )
})
