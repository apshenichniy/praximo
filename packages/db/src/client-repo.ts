import type { CoachLanguage } from "@praximo/domain"
import { and, asc, eq, gte, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

/**
 * The coach's own clients: creating one, listing them, reading one, undoing a
 * creation, and reissuing an invitation (#56).
 *
 * Two of these are single statements because they have to be. The neon-http
 * driver has no interactive transactions (`client.ts`), so "the client and the
 * invitation are created together" and "the fresh invitation expires the one it
 * replaces" are written as one statement each, with CTEs, rather than as a pair
 * of calls that can half-succeed.
 */

/** What a client's invitation is *at read time*, which is not always its column. */
export type ClientState = "invited" | "expired" | "accepted"

export interface ClientListRow {
  readonly id: string
  readonly name: string
  readonly state: ClientState
  readonly invitedAt: Date
  readonly inviteExpiresAt: Date
  /** When somebody actually walked through the door. */
  readonly acceptedAt?: Date
}

export interface ClientInviteRow {
  readonly id: string
  readonly token: string
  readonly status: "pending" | "accepted" | "expired"
  readonly expiresAt: Date
  /** The language the invitation was *written* in — never the client's own. */
  readonly language: CoachLanguage
}

export interface ClientChannelRow {
  readonly kind: string
  readonly address?: string
  readonly telegramName?: string
  readonly telegramUsername?: string
}

export interface ClientSessionRow {
  readonly id: string
  readonly scheduledAt: Date
  readonly durationMinutes: number
  readonly kind: string
  readonly state: string
}

export interface ClientDetailRow {
  readonly id: string
  readonly name: string
  readonly state: ClientState
  readonly language?: CoachLanguage
  readonly createdAt: Date
  readonly invite?: ClientInviteRow
  readonly channel?: ClientChannelRow
  readonly acceptedAt?: Date
  readonly consentGrantedAt?: Date
  readonly sessions: ReadonlyArray<ClientSessionRow>
  /**
   * Whether "undo the creation" is still available: nothing accepted, nothing
   * scheduled. Erasure of a client who has a history is #74's, with its cascade
   * and its consent revocation.
   */
  readonly canDelete: boolean
}

export interface CreateWithInviteInput {
  readonly workspaceId: string
  readonly clientId: string
  readonly inviteId: string
  readonly name: string
  readonly token: string
  readonly inviteLanguage: CoachLanguage
  readonly now: Date
  readonly expiresAt: Date
}

export interface ReissueInviteInput {
  readonly workspaceId: string
  readonly clientId: string
  readonly inviteId: string
  readonly token: string
  readonly inviteLanguage: CoachLanguage
  readonly now: Date
  readonly expiresAt: Date
}

export interface ReissuedInvite {
  readonly token: string
  readonly expiresAt: Date
}

export interface Interface {
  readonly createWithInvite: (input: CreateWithInviteInput) => Effect.Effect<void, QueryFailed>
  readonly list: (
    workspaceId: string,
    now: Date,
  ) => Effect.Effect<ReadonlyArray<ClientListRow>, QueryFailed>
  readonly find: (
    workspaceId: string,
    clientId: string,
    now: Date,
  ) => Effect.Effect<ClientDetailRow | undefined, QueryFailed>
  readonly deleteUnaccepted: (
    workspaceId: string,
    clientId: string,
  ) => Effect.Effect<{ readonly deleted: boolean }, QueryFailed>
  readonly reissueInvite: (
    input: ReissueInviteInput,
  ) => Effect.Effect<ReissuedInvite | undefined, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/db/ClientRepo") {}

/**
 * Timestamps as ISO text.
 *
 * The raw statements below go through `execute`, which hands back whatever the
 * driver decoded rather than the typed columns the query builder maps — and
 * Postgres's own `2026-07-26 09:00:00+00` is not a format `new Date` is
 * required to parse. Formatting in SQL makes the boundary explicit instead of
 * leaving it to a parser's good will.
 */
const iso = (column: string) =>
  sql.raw(`to_char(${column} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)

const readDate = (value: unknown): Date | undefined =>
  typeof value === "string" ? new Date(value) : undefined

/**
 * The state word the list and the header colour, derived rather than stored.
 *
 * Expiry by time is a *read*: `expires_at` in the past is expired whatever the
 * column says, which is why no cron writes that status. The one writer of the
 * stored `expired` is a reissue, and it means "this link was replaced".
 */
const clientState = (
  status: string | undefined,
  expiresAt: Date | undefined,
  now: Date,
): ClientState => {
  if (status === "accepted") return "accepted"
  if (status === "expired") return "expired"
  if (expiresAt !== undefined && expiresAt.getTime() <= now.getTime()) return "expired"
  return "invited"
}

const language = (value: unknown): CoachLanguage | undefined =>
  value === "en" || value === "uk" || value === "ru" ? value : undefined

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    /**
     * One screen, one commit: the client and the invitation land together or
     * not at all.
     *
     * The seven-day window therefore starts at *creation* rather than at
     * delivery — the coach who enters five existing clients in one sitting has
     * five windows running, and the answer to that is Reissue, not a lazier
     * mint.
     */
    const createWithInvite = Effect.fn("ClientRepo.createWithInvite")(function* (
      input: CreateWithInviteInput,
    ) {
      const delivery = JSON.stringify({ kind: "telegram", language: input.inviteLanguage })
      yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            with "created" as (
              insert into "client" ("id", "workspace_id", "name", "created_at", "updated_at")
              values (${input.clientId}, ${input.workspaceId}, ${input.name}, ${input.now}, ${input.now})
              returning "id", "workspace_id"
            )
            insert into "invite" (
              "id", "workspace_id", "client_id", "token", "status", "delivery",
              "expires_at", "created_at"
            )
            select
              ${input.inviteId}, "created"."workspace_id", "created"."id", ${input.token},
              'pending', ${delivery}::jsonb, ${input.expiresAt}, ${input.now}
            from "created"
          `),
        catch: (cause) => new QueryFailed({ operation: "client.createWithInvite", cause }),
      })
    })

    /**
     * The home screen's list, newest client first.
     *
     * One statement: a client's latest invitation and its primary channel are
     * both at most one row, and a list screen that costs three round trips per
     * render is a list screen that gets cached badly later.
     */
    const list = Effect.fn("ClientRepo.list")(function* (workspaceId: string, now: Date) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            select
              "c"."id" as "id",
              "c"."name" as "name",
              "i"."status" as "invite_status",
              ${iso('"i"."expires_at"')} as "expires_at",
              ${iso('"i"."created_at"')} as "invited_at",
              ${iso('"ch"."created_at"')} as "accepted_at"
            from "client" as "c"
            left join lateral (
              select "status", "expires_at", "created_at"
              from "invite"
              where "invite"."client_id" = "c"."id"
              order by "invite"."created_at" desc
              limit 1
            ) as "i" on true
            left join "channel" as "ch"
              on "ch"."client_id" = "c"."id" and "ch"."is_primary"
            where "c"."workspace_id" = ${workspaceId}
            order by "c"."created_at" desc
          `),
        catch: (cause) => new QueryFailed({ operation: "client.list", cause }),
      })

      return rows.rows.map((row) => {
        const record = row as Record<string, unknown>
        const acceptedAt = readDate(record.accepted_at)
        const expiresAt = readDate(record.expires_at) ?? now
        return {
          id: String(record.id),
          name: String(record.name),
          state: clientState(
            acceptedAt === undefined ? (record.invite_status as string | undefined) : "accepted",
            expiresAt,
            now,
          ),
          invitedAt: readDate(record.invited_at) ?? now,
          inviteExpiresAt: expiresAt,
          ...(acceptedAt === undefined ? {} : { acceptedAt }),
        } satisfies ClientListRow
      })
    })

    /**
     * One client, with everything its route shows and the two facts that decide
     * what it may still do.
     *
     * The sessions come back in a second query rather than as an aggregate: they
     * are a list on the screen, they carry typed timestamps through the query
     * builder, and folding them into the row above would trade clarity for a
     * round trip nobody is counting on this screen.
     */
    const find = Effect.fn("ClientRepo.find")(function* (
      workspaceId: string,
      clientId: string,
      now: Date,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            select
              "c"."id" as "id",
              "c"."name" as "name",
              "c"."language" as "language",
              ${iso('"c"."created_at"')} as "created_at",
              "i"."id" as "invite_id",
              "i"."token" as "token",
              "i"."status" as "invite_status",
              "i"."delivery" as "delivery",
              ${iso('"i"."expires_at"')} as "expires_at",
              "ch"."kind" as "channel_kind",
              "ch"."address" as "channel_address",
              "ch"."telegram_snapshot" as "telegram_snapshot",
              ${iso('"ch"."created_at"')} as "accepted_at",
              ${iso('"cg"."granted_at"')} as "consent_granted_at",
              exists (
                select 1 from "session" as "s" where "s"."client_id" = "c"."id"
              ) as "has_sessions"
            from "client" as "c"
            left join lateral (
              select "id", "token", "status", "delivery", "expires_at"
              from "invite"
              where "invite"."client_id" = "c"."id"
              order by "invite"."created_at" desc
              limit 1
            ) as "i" on true
            left join "channel" as "ch"
              on "ch"."client_id" = "c"."id" and "ch"."is_primary"
            left join lateral (
              select "granted_at"
              from "consent_grant"
              where "consent_grant"."client_id" = "c"."id" and not "consent_grant"."revoked"
              order by "consent_grant"."granted_at" desc
              limit 1
            ) as "cg" on true
            where "c"."id" = ${clientId} and "c"."workspace_id" = ${workspaceId}
            limit 1
          `),
        catch: (cause) => new QueryFailed({ operation: "client.find", cause }),
      })

      const record = rows.rows[0] as Record<string, unknown> | undefined
      if (record === undefined) return undefined

      const sessions = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              id: schema.session.id,
              scheduledAt: schema.session.scheduledAt,
              durationMinutes: schema.session.durationMinutes,
              kind: schema.session.kind,
              state: schema.session.state,
            })
            .from(schema.session)
            .where(
              and(
                eq(schema.session.clientId, clientId),
                eq(schema.session.state, "scheduled"),
                gte(schema.session.scheduledAt, now),
              ),
            )
            .orderBy(asc(schema.session.scheduledAt)),
        catch: (cause) => new QueryFailed({ operation: "client.find.sessions", cause }),
      })

      const acceptedAt = readDate(record.accepted_at)
      const inviteStatus = record.invite_status as ClientInviteRow["status"] | undefined
      const expiresAt = readDate(record.expires_at)
      const clientLanguage = language(record.language)
      const consentGrantedAt = readDate(record.consent_granted_at)
      const delivery = record.delivery as { readonly language?: string } | null
      const snapshot = record.telegram_snapshot as {
        readonly name?: string
        readonly username?: string
      } | null

      return {
        id: String(record.id),
        name: String(record.name),
        state: clientState(
          acceptedAt === undefined ? inviteStatus : "accepted",
          expiresAt,
          now,
        ),
        ...(clientLanguage === undefined ? {} : { language: clientLanguage }),
        createdAt: readDate(record.created_at) ?? now,
        ...(record.invite_id === null || record.invite_id === undefined || expiresAt === undefined
          ? {}
          : {
              invite: {
                id: String(record.invite_id),
                token: String(record.token),
                status: inviteStatus ?? "pending",
                expiresAt,
                language: language(delivery?.language) ?? "en",
              },
            }),
        ...(record.channel_kind === null || record.channel_kind === undefined
          ? {}
          : {
              channel: {
                kind: String(record.channel_kind),
                ...(record.channel_address === null || record.channel_address === undefined
                  ? {}
                  : { address: String(record.channel_address) }),
                ...(snapshot?.name === undefined ? {} : { telegramName: snapshot.name }),
                ...(snapshot?.username === undefined
                  ? {}
                  : { telegramUsername: snapshot.username }),
              },
            }),
        ...(acceptedAt === undefined ? {} : { acceptedAt }),
        ...(consentGrantedAt === undefined ? {} : { consentGrantedAt }),
        sessions,
        canDelete: inviteStatus !== "accepted" && record.has_sessions !== true,
      } satisfies ClientDetailRow
    })

    /**
     * "Undo the creation", not erasure.
     *
     * The two conditions are in the statement rather than read first because
     * they are the whole guarantee: between a read and a delete a client can
     * accept, and #74 owns the hard delete precisely so this one can be this
     * narrow. Everything hanging off the client cascades on `client_id`.
     */
    const deleteUnaccepted = Effect.fn("ClientRepo.deleteUnaccepted")(function* (
      workspaceId: string,
      clientId: string,
    ) {
      const result = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            delete from "client"
            where
              "client"."id" = ${clientId}
              and "client"."workspace_id" = ${workspaceId}
              and not exists (
                select 1 from "invite"
                where "invite"."client_id" = "client"."id" and "invite"."status" = 'accepted'
              )
              and not exists (
                select 1 from "session" where "session"."client_id" = "client"."id"
              )
            returning "id"
          `),
        catch: (cause) => new QueryFailed({ operation: "client.deleteUnaccepted", cause }),
      })
      return { deleted: result.rows.length > 0 }
    })

    /**
     * A fresh invitation, and the one it replaces marked `expired` — the only
     * writer of that status.
     *
     * Refuses once the client has accepted: there is no door left to reopen, and
     * a second link would only send a client who is already in back through it.
     * `undefined` is that refusal, and it is also what a client of another
     * workspace gets.
     */
    const reissueInvite = Effect.fn("ClientRepo.reissueInvite")(function* (
      input: ReissueInviteInput,
    ) {
      const delivery = JSON.stringify({ kind: "telegram", language: input.inviteLanguage })
      const result = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            with "target" as (
              select "c"."id", "c"."workspace_id"
              from "client" as "c"
              where
                "c"."id" = ${input.clientId}
                and "c"."workspace_id" = ${input.workspaceId}
                and not exists (
                  select 1 from "invite"
                  where "invite"."client_id" = "c"."id" and "invite"."status" = 'accepted'
                )
            ),
            "replaced" as (
              update "invite"
              set "status" = 'expired'
              from "target"
              where "invite"."client_id" = "target"."id" and "invite"."status" = 'pending'
              returning "invite"."id"
            )
            insert into "invite" (
              "id", "workspace_id", "client_id", "token", "status", "delivery",
              "expires_at", "created_at"
            )
            select
              ${input.inviteId}, "target"."workspace_id", "target"."id", ${input.token},
              'pending', ${delivery}::jsonb, ${input.expiresAt}, ${input.now}
            from "target"
            returning "token", ${iso('"expires_at"')} as "expires_at"
          `),
        catch: (cause) => new QueryFailed({ operation: "client.reissueInvite", cause }),
      })

      const record = result.rows[0] as Record<string, unknown> | undefined
      if (record === undefined) return undefined
      return {
        token: String(record.token),
        expiresAt: readDate(record.expires_at) ?? input.expiresAt,
      } satisfies ReissuedInvite
    })

    return Service.of({ createWithInvite, list, find, deleteUnaccepted, reissueInvite })
  }),
)

export * as ClientRepo from "./client-repo.ts"
