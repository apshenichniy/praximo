import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

/**
 * Scheduling, the day's bookings the sheet draws its grid from (#56), and the
 * sessions Today and the sessions list are built out of (#61).
 *
 * The states that hold a slot. A cancelled session releases the time it was
 * holding, and a completed one is in the past by definition — only these two can
 * be in the coach's way.
 */
const LiveStates = ["scheduled", "in_progress"] as const

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
  readonly state: string
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
  readonly state: string
  readonly channelId: string | null
}): ScheduledSessionRow => ({
  id: row.id,
  clientId: row.clientId,
  clientName: row.clientName,
  scheduledAt: row.scheduledAt,
  durationMinutes: row.durationMinutes,
  kind: row.kind,
  state: row.state,
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
                inArray(schema.session.state, [...LiveStates]),
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
                inArray(schema.session.state, [...LiveStates]),
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

    return Service.of({ schedule, between, scheduled, find })
  }),
)

export * as SessionRepo from "./session-repo.ts"
