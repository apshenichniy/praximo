import {
  type ClientInviteDeliveryKind,
  ClientInviteStatus,
  type CoachLanguage,
  inviteStanding,
} from "@praximo/domain"
import { and, asc, eq, gte, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Database, QueryFailed } from "./client.ts"
import { isoColumn, readDate, readLanguage } from "./row-readers.ts"
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

/**
 * What was actually handed over, and when (#224).
 *
 * Absent until the coach's first successful share or copy. The pair travels
 * together because before that first send `delivery.kind` is a creation default
 * rather than a record, and a door without a moment says nothing.
 */
export interface InviteDeliveryRow {
  readonly at: Date
  readonly kind: string
}

/**
 * Whether this client has a photo — never the key (#231).
 *
 * The screens need to know which discs to ask for and which are initials, and
 * that is all they need: the key is resolved again, workspace-scoped, by the route
 * that serves the bytes. A boolean here is what keeps an object key out of a
 * payload, out of the HTML, and out of anything a browser could quote back.
 */
export interface ClientAvatarPresence {
  readonly hasAvatar: boolean
}

export interface ClientListRow extends ClientAvatarPresence {
  readonly id: string
  readonly name: string
  readonly state: ClientState
  readonly invitedAt: Date
  readonly inviteExpiresAt: Date
  /** When somebody actually walked through the door. */
  readonly acceptedAt?: Date
  readonly delivered?: InviteDeliveryRow
}

export interface ClientInviteRow {
  readonly id: string
  readonly token: string
  readonly status: ClientInviteStatus
  readonly expiresAt: Date
  /** The language the invitation was *written* in — never the client's own. */
  readonly language: CoachLanguage
  readonly delivered?: InviteDeliveryRow
  /**
   * The address this invitation was emailed to, or carried forward from the one
   * it replaced (#58).
   *
   * Read separately from {@link delivered} rather than folded into it, because
   * the two answer different questions and get out of step on purpose. A reissue
   * carries the address and *not* the delivery — the coach should not retype an
   * address they already gave us, and the fresh link has still been sent
   * nowhere. A later copy moves the door to `link` and leaves the address alone.
   */
  readonly address?: string
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

export interface ClientDetailRow extends ClientAvatarPresence {
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

export interface RecordDeliveryInput {
  readonly workspaceId: string
  readonly clientId: string
  /**
   * The door, as the domain's own closed set.
   *
   * Narrow on the way *in* and wide on the way out (`InviteDeliveryRow.kind` is
   * a plain `string`), which is not an inconsistency: what this writes is
   * decided by code we control, and what `find` reads back is whatever is in the
   * column — including a value written by a deploy this one predates.
   */
  readonly kind: ClientInviteDeliveryKind
  /**
   * Where it went, for a service-sent invitation (#58).
   *
   * Only the `email` door has one — the other two hand the token to a person,
   * not to an address — and it is written with the moment, after Cloudflare has
   * accepted the message and never before.
   */
  readonly address?: string
  readonly now: Date
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
  /**
   * Write down that the coach handed this invitation over, and through which
   * door (#224).
   *
   * `{ recorded: false }` for a client of another workspace, a client that does
   * not exist, and an invitation that is no longer open — a screen that has gone
   * stale must not restamp an invitation the client already used.
   */
  readonly recordDelivery: (
    input: RecordDeliveryInput,
  ) => Effect.Effect<{ readonly recorded: boolean }, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/db/ClientRepo") {}

/**
 * The state word the list and the header colour, derived rather than stored.
 *
 * Expiry by time is a *read*: `expires_at` in the past is expired whatever the
 * column says, which is why no cron writes that status. The one writer of the
 * stored `expired` is a reissue, and it means "this link was replaced".
 */
const stateByStanding = {
  open: "invited",
  accepted: "accepted",
  superseded: "expired",
  lapsed: "expired",
} as const satisfies Record<ReturnType<typeof inviteStanding>, ClientState>

type ClientStandingInput =
  | { readonly status: "accepted" | "expired" }
  | { readonly status: "pending"; readonly expiresAt: Date }

const standingInput = (
  status: ClientInviteStatus | undefined,
  expiresAt: Date | undefined,
): ClientStandingInput | undefined =>
  status === "accepted" || status === "expired"
    ? { status }
    : expiresAt === undefined
      ? undefined
      : { status: "pending", expiresAt }

const clientState = (input: ClientStandingInput | undefined, now: Date): ClientState => {
  if (input === undefined) return "invited"
  const nowMillis = now.getTime()
  const expiresAt = input.status === "pending" ? input.expiresAt.getTime() : nowMillis
  return stateByStanding[inviteStanding(input.status, expiresAt, nowMillis)]
}

const decodeInviteStatus = Schema.decodeUnknownOption(ClientInviteStatus)

const readInviteStatus = (value: unknown): ClientInviteStatus | undefined =>
  Option.getOrUndefined(decodeInviteStatus(value))

/**
 * The delivery record, read as the pair it is (#224).
 *
 * `delivery.kind` alone is not one: every invitation is created with `telegram`
 * in that key, and reading it before `delivered_at` exists would report a door
 * nobody has walked through yet. The moment is what makes the door a fact.
 */
const deliveryOf = (
  deliveredAt: unknown,
  delivery: { readonly kind?: string } | null,
): InviteDeliveryRow | undefined => {
  const at = readDate(deliveredAt)
  if (at === undefined || delivery?.kind === undefined) return undefined
  return { at, kind: delivery.kind }
}

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
              "c"."avatar_r2_key" is not null as "has_avatar",
              "i"."status" as "invite_status",
              "i"."delivery" as "delivery",
              ${isoColumn('"i"."delivered_at"')} as "delivered_at",
              ${isoColumn('"i"."expires_at"')} as "expires_at",
              ${isoColumn('"i"."created_at"')} as "invited_at",
              ${isoColumn('"ch"."created_at"')} as "accepted_at"
            from "client" as "c"
            left join lateral (
              select "status", "delivery", "delivered_at", "expires_at", "created_at"
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
        const inviteStatus = readInviteStatus(record.invite_status)
        const delivered = deliveryOf(
          record.delivered_at,
          record.delivery as { readonly kind?: string } | null,
        )
        return {
          id: String(record.id),
          name: String(record.name),
          hasAvatar: record.has_avatar === true,
          state: clientState(
            standingInput(acceptedAt === undefined ? inviteStatus : "accepted", expiresAt),
            now,
          ),
          invitedAt: readDate(record.invited_at) ?? now,
          inviteExpiresAt: expiresAt,
          ...(acceptedAt === undefined ? {} : { acceptedAt }),
          ...(delivered === undefined ? {} : { delivered }),
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
              "c"."avatar_r2_key" is not null as "has_avatar",
              ${isoColumn('"c"."created_at"')} as "created_at",
              "i"."id" as "invite_id",
              "i"."token" as "token",
              "i"."status" as "invite_status",
              "i"."delivery" as "delivery",
              ${isoColumn('"i"."delivered_at"')} as "delivered_at",
              ${isoColumn('"i"."expires_at"')} as "expires_at",
              "ch"."kind" as "channel_kind",
              "ch"."address" as "channel_address",
              "ch"."snapshot" as "snapshot",
              ${isoColumn('"ch"."created_at"')} as "accepted_at",
              ${isoColumn('"cg"."granted_at"')} as "consent_granted_at",
              exists (
                select 1 from "session" as "s" where "s"."client_id" = "c"."id"
              ) as "has_sessions"
            from "client" as "c"
            left join lateral (
              select "id", "token", "status", "delivery", "delivered_at", "expires_at"
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
      const inviteStatus = readInviteStatus(record.invite_status)
      const expiresAt = readDate(record.expires_at)
      const clientLanguage = readLanguage(record.language)
      const consentGrantedAt = readDate(record.consent_granted_at)
      const delivery = record.delivery as {
        readonly language?: string
        readonly kind?: string
        readonly address?: string
      } | null
      const delivered = deliveryOf(record.delivered_at, delivery)
      const snapshot = record.snapshot as {
        readonly name?: string
        readonly username?: string
      } | null

      return {
        id: String(record.id),
        name: String(record.name),
        hasAvatar: record.has_avatar === true,
        state: clientState(
          standingInput(acceptedAt === undefined ? inviteStatus : "accepted", expiresAt),
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
                language: readLanguage(delivery?.language) ?? "en",
                ...(delivered === undefined ? {} : { delivered }),
                // Independent of `delivered` on purpose: a reissue carries this
                // and drops that, so the sheet still opens pre-filled (#58).
                ...(typeof delivery?.address === "string" && delivery.address.length > 0
                  ? { address: delivery.address }
                  : {}),
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
     *
     * **The address rides across; the delivery does not** (#58). The spec's
     * «re-issue copies the delivery target» is honoured for the one part of the
     * target that is still true — where this client can be reached — while
     * `kind` returns to the creation default and `delivered_at` starts empty,
     * because the new link has been sent nowhere. Carried in SQL rather than
     * passed by the caller: a forgotten argument would silently cost the coach
     * an address they had already given us, and there is no screen on which that
     * would look like a bug.
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
            "carried" as (
              select "i"."delivery" -> 'address' as "address"
              from "invite" as "i"
              join "target" on "i"."client_id" = "target"."id"
              order by "i"."created_at" desc
              limit 1
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
              'pending',
              ${delivery}::jsonb || coalesce(
                (
                  select jsonb_build_object('address', "carried"."address")
                  from "carried"
                  where "carried"."address" is not null
                ),
                '{}'::jsonb
              ),
              ${input.expiresAt}, ${input.now}
            from "target"
            returning "token", ${isoColumn('"expires_at"')} as "expires_at"
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

    /**
     * Delivery, written down instead of assumed (#224).
     *
     * **The kind is merged into `delivery`, never assigned over it.** That
     * object also holds `language` — the language the invitation was written
     * in, which #57's Acceptance Page reads to pre-select the language the
     * consent is granted in. A replace here would drop it, and nothing on either
     * screen would say so until a client met a page in the wrong language.
     *
     * **The last delivery wins**, and both facts move together: a moment that
     * could belong to one door while the kind named another would let the state
     * word say «отправлено ссылкой» about a Telegram send.
     *
     * Scoped by `workspace_id` on the invitation itself, and to the latest
     * *pending* one. A reissue therefore starts the record again at nothing,
     * which is correct — the link the client holds is dead and the new one has
     * not been sent — and an invitation already accepted is not restamped by a
     * screen that has gone stale.
     */
    const recordDelivery = Effect.fn("ClientRepo.recordDelivery")(function* (
      input: RecordDeliveryInput,
    ) {
      const result = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            update "invite"
            set
              "delivered_at" = ${input.now},
              "delivery" = "delivery" || ${JSON.stringify(
                input.address === undefined
                  ? { kind: input.kind }
                  : { kind: input.kind, address: input.address },
              )}::jsonb
            where "invite"."id" = (
              select "id"
              from "invite"
              where
                "invite"."client_id" = ${input.clientId}
                and "invite"."workspace_id" = ${input.workspaceId}
                and "invite"."status" = 'pending'
              order by "invite"."created_at" desc
              limit 1
            )
            returning "id"
          `),
        catch: (cause) => new QueryFailed({ operation: "client.recordDelivery", cause }),
      })
      return { recorded: result.rows.length > 0 }
    })

    return Service.of({
      createWithInvite,
      list,
      find,
      deleteUnaccepted,
      reissueInvite,
      recordDelivery,
    })
  }),
)

export * as ClientRepo from "./client-repo.ts"
