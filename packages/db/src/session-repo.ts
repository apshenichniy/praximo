import { LiveSessionStates, type SessionCancelReason, type SessionState } from "@praximo/domain"
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

/**
 * Scheduling, the day's bookings the sheet draws its grid from (#56), the
 * sessions Today and the sessions list are built out of (#61), and the two
 * lifecycle writes a coach can make (#62).
 *
 * `LiveSessionStates` is the pair that holds a slot: a cancelled session
 * releases the time it was holding, and a completed one is in the past by
 * definition — only these two can be in the coach's way.
 */

/** What a booking commits. */
export interface ScheduleInput {
  readonly workspaceId: string
  readonly clientId: string
  readonly sessionId: string
  readonly scheduledAt: Date
  readonly durationMinutes: number
  readonly kind: string
  readonly now: Date
}

/**
 * Why a booking did not happen, in the two ways it can fail at the database.
 * Everything the *screen* can decide — a start off the grid, a duration the
 * product does not plan, a time already past — is refused before this.
 */
export type ScheduleOutcome =
  | { readonly scheduled: true }
  | { readonly scheduled: false; readonly reason: "overlap" | "unknown-client" }

export interface BusySession {
  readonly scheduledAt: Date
  readonly durationMinutes: number
}

/** Where a session is being moved to. Its client and kind do not change (#62). */
export interface RescheduleInput {
  readonly workspaceId: string
  readonly sessionId: string
  readonly scheduledAt: Date
  readonly durationMinutes: number
  readonly now: Date
}

/**
 * Why a move did not happen, in the two ways it can fail at the database.
 *
 * `gone` covers every reason the row was not there to move — cancelled, running,
 * never existed, or another workspace's. They are one word on purpose: the
 * screen's answer to all four is the same, and telling them apart would let a
 * coach learn that a session id exists in a practice that is not theirs.
 */
export type RescheduleOutcome =
  | { readonly rescheduled: true }
  | { readonly rescheduled: false; readonly reason: "overlap" | "gone" }

/**
 * A session as every screen that lists one needs it (#61): the facts of the
 * booking, the client it belongs to, and the one thing that can be wrong with an
 * otherwise healthy session.
 */
export interface ScheduledSessionRow {
  readonly id: string
  readonly clientId: string
  readonly clientName: string
  readonly scheduledAt: Date
  readonly durationMinutes: number
  readonly kind: string
  readonly state: SessionState
  /**
   * Why it stopped being scheduled — absent on every state but `cancelled`, and
   * the difference between «the coach called it off» and «nobody came» (#62).
   */
  readonly cancelReason?: SessionCancelReason
  /**
   * Whether the client ever walked through the door. A Channel exists only after
   * acceptance, and the join link travels through it — so a session for a client
   * without one is real, on the day, and undeliverable
   * (client-onboarding-auth.md §Session-first flow).
   */
  readonly clientAccepted: boolean
}

export interface ScheduledQuery {
  readonly workspaceId: string
  readonly from: Date
  /** Absent for "everything ahead of `from`" — present for one day's window. */
  readonly to?: Date
  readonly limit: number
}

export interface Interface {
  readonly schedule: (input: ScheduleInput) => Effect.Effect<ScheduleOutcome, QueryFailed>
  readonly between: (
    workspaceId: string,
    from: Date,
    to: Date,
  ) => Effect.Effect<ReadonlyArray<BusySession>, QueryFailed>
  /** Live sessions in a window, earliest first — Today's day and the flat list. */
  readonly scheduled: (
    query: ScheduledQuery,
  ) => Effect.Effect<ReadonlyArray<ScheduledSessionRow>, QueryFailed>
  /** One session, in whatever state it is in — the session screen's own read. */
  readonly find: (
    workspaceId: string,
    sessionId: string,
  ) => Effect.Effect<ScheduledSessionRow | undefined, QueryFailed>
  /** Move a scheduled session; its id, client and kind are untouched (#62). */
  readonly reschedule: (input: RescheduleInput) => Effect.Effect<RescheduleOutcome, QueryFailed>
  /**
   * The coach's own cancellation. `false` means the row was not `scheduled` for
   * this workspace — already cancelled, already running, or not theirs.
   */
  readonly cancel: (
    workspaceId: string,
    sessionId: string,
    now: Date,
  ) => Effect.Effect<{ readonly cancelled: boolean }, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/db/SessionRepo") {}

/**
 * One joined row as every listing screen reads it. The channel is selected as an
 * id so that its *absence* is the answer: no Channel, no accepted invitation, no
 * way to send a join link.
 */
const readListing = (row: {
  readonly id: string
  readonly clientId: string
  readonly clientName: string
  readonly scheduledAt: Date
  readonly durationMinutes: number
  readonly kind: string
  readonly state: SessionState
  readonly cancelReason: SessionCancelReason | null
  readonly channelId: string | null
}): ScheduledSessionRow => ({
  id: row.id,
  clientId: row.clientId,
  clientName: row.clientName,
  scheduledAt: row.scheduledAt,
  durationMinutes: row.durationMinutes,
  kind: row.kind,
  state: row.state,
  ...(row.cancelReason === null ? {} : { cancelReason: row.cancelReason }),
  clientAccepted: row.channelId !== null,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    /**
     * One statement, and the overlap check inside it.
     *
     * A read followed by an insert would lose exactly the race this exists to
     * prevent: the coach on two devices, or a second tap on a slow network,
     * booking the same slot twice. The insert selects from a guard that names
     * the client *within this workspace* — so tenancy is enforced by the same
     * statement rather than by the caller remembering to filter — and produces
     * no row when the time is taken.
     *
     * The two refusals are told apart by a second, cheap probe rather than by a
     * cleverer statement: they mean different things to the screen, and the
     * probe only runs on the failing path.
     */
    const schedule = Effect.fn("SessionRepo.schedule")(function* (input: ScheduleInput) {
      const inserted = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            insert into "session" (
              "id", "workspace_id", "client_id", "scheduled_at", "duration_minutes",
              "kind", "state", "created_at", "updated_at"
            )
            select
              ${input.sessionId}, "c"."workspace_id", "c"."id", ${input.scheduledAt},
              ${input.durationMinutes}, ${input.kind}, 'scheduled', ${input.now}, ${input.now}
            from "client" as "c"
            where
              "c"."id" = ${input.clientId}
              and "c"."workspace_id" = ${input.workspaceId}
              and not exists (
                select 1 from "session" as "s"
                where
                  "s"."workspace_id" = "c"."workspace_id"
                  and "s"."state" in ('scheduled', 'in_progress')
                  and "s"."scheduled_at" < ${new Date(
                    input.scheduledAt.getTime() + input.durationMinutes * 60_000,
                  )}
                  and "s"."scheduled_at" + make_interval(mins => "s"."duration_minutes")
                      > ${input.scheduledAt}
              )
            returning "id"
          `),
        catch: (cause) => new QueryFailed({ operation: "session.schedule", cause }),
      })

      if (inserted.rows.length > 0) return { scheduled: true } as const

      const known = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ id: schema.client.id })
            .from(schema.client)
            .where(
              and(
                eq(schema.client.id, input.clientId),
                eq(schema.client.workspaceId, input.workspaceId),
              ),
            )
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "session.schedule.probe", cause }),
      })

      return {
        scheduled: false,
        reason: known.length > 0 ? ("overlap" as const) : ("unknown-client" as const),
      } as const
    })

    /**
     * Every live session that starts inside a window — the day the coach is
     * looking at, in their own zone, which is why the caller passes instants
     * rather than a date.
     *
     * A session starting *before* the window and running into it cannot exist:
     * the day begins at 08:00 local and nothing is bookable across midnight.
     */
    const between = Effect.fn("SessionRepo.between")(function* (
      workspaceId: string,
      from: Date,
      to: Date,
    ) {
      return yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              scheduledAt: schema.session.scheduledAt,
              durationMinutes: schema.session.durationMinutes,
            })
            .from(schema.session)
            .where(
              and(
                eq(schema.session.workspaceId, workspaceId),
                inArray(schema.session.state, [...LiveSessionStates]),
                gte(schema.session.scheduledAt, from),
                lt(schema.session.scheduledAt, to),
              ),
            )
            .orderBy(asc(schema.session.scheduledAt)),
        catch: (cause) => new QueryFailed({ operation: "session.between", cause }),
      })
    })

    /**
     * The columns every listing screen reads, joined once.
     *
     * The client is an inner join because a session without one cannot exist;
     * the channel is a left join because its *absence* is the fact being read —
     * that is what "the invitation was never accepted" looks like in the schema.
     */
    const listing = () =>
      client
        .select({
          id: schema.session.id,
          clientId: schema.client.id,
          clientName: schema.client.name,
          scheduledAt: schema.session.scheduledAt,
          durationMinutes: schema.session.durationMinutes,
          kind: schema.session.kind,
          state: schema.session.state,
          cancelReason: schema.session.cancelReason,
          channelId: schema.channel.id,
        })
        .from(schema.session)
        .innerJoin(schema.client, eq(schema.client.id, schema.session.clientId))
        .leftJoin(
          schema.channel,
          and(eq(schema.channel.clientId, schema.client.id), eq(schema.channel.isPrimary, true)),
        )

    /**
     * Today's day and the flat upcoming list, from the same statement.
     *
     * `to` is what tells them apart: Today asks for one day in the coach's own
     * zone — including the sessions of it that have already started, because a
     * day is what the screen is about — and the list asks for everything ahead.
     * Both are bounded by `limit`, and the caller says what the bound means.
     */
    const scheduled = Effect.fn("SessionRepo.scheduled")(function* (query: ScheduledQuery) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          listing()
            .where(
              and(
                eq(schema.session.workspaceId, query.workspaceId),
                inArray(schema.session.state, [...LiveSessionStates]),
                gte(schema.session.scheduledAt, query.from),
                ...(query.to === undefined ? [] : [lt(schema.session.scheduledAt, query.to)]),
              ),
            )
            .orderBy(asc(schema.session.scheduledAt))
            .limit(query.limit),
        catch: (cause) => new QueryFailed({ operation: "session.scheduled", cause }),
      })
      return rows.map(readListing)
    })

    /**
     * One session, whatever state it is in.
     *
     * Deliberately not filtered by state: the screen this feeds says what the
     * session *is*, and a cancelled session a coach reached from an old link
     * should read as cancelled rather than as missing.
     */
    const find = Effect.fn("SessionRepo.find")(function* (workspaceId: string, sessionId: string) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          listing()
            .where(
              and(eq(schema.session.workspaceId, workspaceId), eq(schema.session.id, sessionId)),
            )
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "session.find", cause }),
      })
      const row = rows[0]
      return row === undefined ? undefined : readListing(row)
    })

    /**
     * The move, gated and guarded by the one statement that performs it.
     *
     * Three conditions, and each is here rather than in the caller for a
     * different reason. `workspace_id` is tenancy, which the repository owes
     * whatever the caller remembered. `state = 'scheduled'` is the gate: a
     * session the reconciler took, or one the coach cancelled on another device,
     * must not be quietly resurrected into a new slot. And the overlap guard is
     * the race — the same one `schedule` refuses, minus **this session**, which
     * would otherwise collide with itself and refuse every move that stays
     * inside the hour it already holds.
     *
     * The two refusals are told apart by a cheap probe on the failing path, as
     * `schedule` does: they mean different things to the screen, and `gone`
     * deliberately covers "not this workspace's" so that a session id cannot be
     * probed for existence across practices.
     */
    const reschedule = Effect.fn("SessionRepo.reschedule")(function* (input: RescheduleInput) {
      const updated = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            update "session" as "target"
            set
              "scheduled_at" = ${input.scheduledAt},
              "duration_minutes" = ${input.durationMinutes},
              "updated_at" = ${input.now}
            where
              "target"."id" = ${input.sessionId}
              and "target"."workspace_id" = ${input.workspaceId}
              and "target"."state" = 'scheduled'
              and not exists (
                select 1 from "session" as "s"
                where
                  "s"."workspace_id" = "target"."workspace_id"
                  and "s"."id" <> "target"."id"
                  and "s"."state" in ('scheduled', 'in_progress')
                  and "s"."scheduled_at" < ${new Date(
                    input.scheduledAt.getTime() + input.durationMinutes * 60_000,
                  )}
                  and "s"."scheduled_at" + make_interval(mins => "s"."duration_minutes")
                      > ${input.scheduledAt}
              )
            returning "target"."id"
          `),
        catch: (cause) => new QueryFailed({ operation: "session.reschedule", cause }),
      })

      if (updated.rows.length > 0) return { rescheduled: true } as const

      const movable = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ id: schema.session.id })
            .from(schema.session)
            .where(
              and(
                eq(schema.session.id, input.sessionId),
                eq(schema.session.workspaceId, input.workspaceId),
                eq(schema.session.state, "scheduled"),
              ),
            )
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "session.reschedule.probe", cause }),
      })

      return {
        rescheduled: false,
        reason: movable.length > 0 ? ("overlap" as const) : ("gone" as const),
      } as const
    })

    /**
     * The coach's cancellation, conditional on the session still being theirs to
     * cancel.
     *
     * `coach_cancelled` is written here rather than passed in: it is the only
     * reason a human writes, and a reason parameter is how a «mark no-show»
     * button gets added later without anyone having to argue for it (ADR 0005).
     */
    const cancel = Effect.fn("SessionRepo.cancel")(function* (
      workspaceId: string,
      sessionId: string,
      now: Date,
    ) {
      const updated = yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.session)
            .set({ state: "cancelled", cancelReason: "coach_cancelled", updatedAt: now })
            .where(
              and(
                eq(schema.session.id, sessionId),
                eq(schema.session.workspaceId, workspaceId),
                eq(schema.session.state, "scheduled"),
              ),
            )
            .returning({ id: schema.session.id }),
        catch: (cause) => new QueryFailed({ operation: "session.cancel", cause }),
      })

      return { cancelled: updated.length > 0 }
    })

    return Service.of({ schedule, between, scheduled, find, reschedule, cancel })
  }),
)

export * as SessionRepo from "./session-repo.ts"
