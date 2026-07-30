import type { CoachLanguage } from "@praximo/domain"
import { clientConsentVersion } from "@praximo/i18n"
import { eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, QueryFailed } from "./client.ts"
import { CoachNotification } from "./coach-notification.ts"
import { isoColumn, readDate, readLanguage } from "./row-readers.ts"
import * as schema from "./schema.ts"

/**
 * The client's side of the door (#56): resolving the token a `/start` carried,
 * and the one statement that lets them through it.
 *
 * Both halves belong together because both are about a client who does not
 * exist as a participant yet — there is no session, no principal, and nothing
 * to authorize against but the token itself.
 */

export interface InviteLookup {
  readonly inviteId: string
  readonly clientId: string
  readonly clientName: string
  readonly workspaceId: string
  readonly status: "pending" | "accepted" | "expired"
  readonly expiresAt: Date
  /** The language the invitation was written in — the pre-selection, not a choice. */
  readonly inviteLanguage: CoachLanguage
  /**
   * The address the invitation was emailed to, when it was (#58).
   *
   * A pre-selection like the language above, and for the same reason: the client
   * is looking at a page they reached *from* this address, so asking them to
   * type it again is asking them to copy something out of the message that
   * brought them. It is a suggestion and never a commitment — the channel is
   * created from whatever they submit.
   */
  readonly inviteAddress?: string
  /** What the client is told they are joining: their coach's practice. */
  readonly coachName: string
  /**
   * The Telegram identity that already walked through, when one has. It is what
   * separates "you are already set up" from "this link has been used" — the
   * first is the common case and not an error at all.
   */
  readonly acceptedByTelegramId?: string
  /** The coach's zone, so the confirmation can print an offset the client can read. */
  readonly coachTimezone?: string
  readonly nextSession?: {
    readonly scheduledAt: Date
    readonly durationMinutes: number
    readonly kind: string
  }
}

export type ClaimIdentity =
  | {
      readonly kind: "telegram"
      readonly userId: string
      readonly name: string
      readonly username?: string
    }
  | {
      readonly kind: "email"
      readonly address: string
      /**
       * The name the client typed about **themselves**, which is not
       * `client.name`. That column keeps what the coach filed them under.
       */
      readonly clientName: string
      /** Present only when they came through Google (#59); no token is stored. */
      readonly googleSub?: string
    }

export interface ClaimInput {
  readonly inviteId: string
  readonly workspaceId: string
  readonly clientId: string
  readonly identity: ClaimIdentity
  /** The language the consent was read in. */
  readonly language: CoachLanguage
  readonly now: Date
}

const identifier = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`

/** What the coach is told when somebody walks in without them in the room. */
export interface AcceptedClient {
  readonly id: string
  readonly name: string
  readonly language?: CoachLanguage
  readonly telegramName?: string
  readonly telegramUsername?: string
  readonly nextSessionAt?: Date
}

/** Whose assistant a bot is — what the stranger door needs, and nothing more. */
export interface BotOwner {
  readonly workspaceId: string
  readonly workspaceName: string
  readonly coachTelegramId?: string
  readonly coachLanguage: CoachLanguage
}

export interface Interface {
  readonly findByToken: (
    token: string,
    telegramBotId: string,
  ) => Effect.Effect<InviteLookup | undefined, QueryFailed>
  /** The same lookup for the web page, which has no bot id to scope by (#57). */
  readonly findByWebToken: (token: string) => Effect.Effect<InviteLookup | undefined, QueryFailed>
  readonly findBotOwner: (telegramBotId: string) => Effect.Effect<BotOwner | undefined, QueryFailed>
  readonly findAcceptedClient: (
    clientId: string,
  ) => Effect.Effect<AcceptedClient | undefined, QueryFailed>
  readonly claim: (input: ClaimInput) => Effect.Effect<{ readonly accepted: boolean }, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/db/ClientAcceptanceRepo",
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    /**
     * The invitation as both doors need to read it. The only thing that differs
     * between them is `scope` — see the two callers.
     *
     * Expiry is not decided here. The row carries `expires_at` and the caller
     * compares it against its own clock, so this stays a pure read and the
     * refusals are composed in one place per surface.
     */
    const lookupRow = (token: string, scope: ReturnType<typeof sql>) =>
      client.execute(sql`
        select
          "i"."id" as "invite_id",
          "i"."status" as "status",
          "i"."delivery" as "delivery",
          ${isoColumn('"i"."expires_at"')} as "expires_at",
          "c"."id" as "client_id",
          "c"."name" as "client_name",
          "w"."id" as "workspace_id",
          "w"."name" as "coach_name",
          "m"."timezone" as "coach_timezone",
          "ch"."address" as "accepted_by",
          ${isoColumn('"s"."scheduled_at"')} as "session_at",
          "s"."duration_minutes" as "session_duration",
          "s"."kind" as "session_kind"
        from "invite" as "i"
        join "client" as "c" on "c"."id" = "i"."client_id"
        join "workspace" as "w" on "w"."id" = "i"."workspace_id"
        ${scope}
        left join "member" as "m"
          on "m"."workspace_id" = "i"."workspace_id" and "m"."role" = 'owner'
        left join "channel" as "ch"
          on "ch"."client_id" = "c"."id" and "ch"."is_primary"
        left join lateral (
          select "scheduled_at", "duration_minutes", "kind"
          from "session"
          where
            "session"."client_id" = "c"."id"
            and "session"."state" = 'scheduled'
            -- The *next* session, not the earliest one on record: a client
            -- accepting late must not be told about a meeting that has
            -- already been and gone.
            and "session"."scheduled_at" >= now()
          order by "session"."scheduled_at" asc
          limit 1
        ) as "s" on true
        where "i"."token" = ${token}
        limit 1
      `)

    const toLookup = (record: Record<string, unknown> | undefined): InviteLookup | undefined => {
      if (record === undefined) return undefined

      const delivery = record.delivery as {
        readonly language?: string
        readonly address?: string
      } | null
      const sessionAt = readDate(record.session_at)

      return {
        inviteId: String(record.invite_id),
        clientId: String(record.client_id),
        clientName: String(record.client_name),
        workspaceId: String(record.workspace_id),
        status: record.status as InviteLookup["status"],
        expiresAt: readDate(record.expires_at) ?? new Date(0),
        inviteLanguage: readLanguage(delivery?.language) ?? "en",
        ...(typeof delivery?.address === "string" && delivery.address.length > 0
          ? { inviteAddress: delivery.address }
          : {}),
        coachName: String(record.coach_name),
        ...(record.accepted_by === null || record.accepted_by === undefined
          ? {}
          : { acceptedByTelegramId: String(record.accepted_by) }),
        ...(record.coach_timezone === null || record.coach_timezone === undefined
          ? {}
          : { coachTimezone: String(record.coach_timezone) }),
        ...(sessionAt === undefined
          ? {}
          : {
              nextSession: {
                scheduledAt: sessionAt,
                durationMinutes: Number(record.session_duration),
                kind: String(record.session_kind),
              },
            }),
      } satisfies InviteLookup
    }

    /**
     * A token resolves **only inside the workspace of the bot it was presented
     * to**, which is why the bot id is a join condition rather than a check
     * afterwards. A code from another coach's workspace produces no row, and the
     * bot answers that exactly as it answers a stranger's bare `/start` —
     * disclosing neither that the code exists nor whose it is.
     */
    const findByToken = Effect.fn("ClientAcceptanceRepo.findByToken")(function* (
      token: string,
      telegramBotId: string,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          lookupRow(
            token,
            sql`join "bot" as "b"
              on "b"."workspace_id" = "i"."workspace_id"
              and "b"."telegram_bot_id" = ${telegramBotId}`,
          ),
        catch: (cause) => new QueryFailed({ operation: "clientAcceptance.findByToken", cause }),
      })

      return toLookup(rows.rows[0] as Record<string, unknown> | undefined)
    })

    /**
     * The same read for the web page (#57), with no scoping join and none
     * available: the web has no bot id, and asking for one would mean inventing a
     * relationship that the URL does not carry.
     *
     * Nothing is lost by dropping it. `invite.token` is globally `unique`, so the
     * token *is* the scope — where the bot needs the join to stop a code from one
     * coach's workspace resolving inside another's, a bare token can only ever
     * resolve to the workspace that issued it.
     *
     * A workspace with no bot row still resolves, and that is deliberate: a
     * client who is not on Telegram may belong to a coach whose bot is not
     * connected yet, and the link they were handed has to open regardless.
     */
    const findByWebToken = Effect.fn("ClientAcceptanceRepo.findByWebToken")(function* (
      token: string,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () => lookupRow(token, sql``),
        catch: (cause) => new QueryFailed({ operation: "clientAcceptance.findByWebToken", cause }),
      })

      return toLookup(rows.rows[0] as Record<string, unknown> | undefined)
    })

    /**
     * The one atomic commit shared by both Doors.
     *
     * `where "status" = 'pending'` is the gate, and every other write selects
     * from that update. The identity variant supplies the only differences:
     * profile update, Channel address and snapshot. Channel and Consent Grant
     * kinds both come from the same discriminant and therefore cannot drift.
     */
    const claim = Effect.fn("ClientAcceptanceRepo.claim")(function* (input: ClaimInput) {
      const kind = CoachNotification.Kind.ClientAccepted
      const workspaceId = sql`"coach"."workspace_id"`
      const clientId = sql`"coach"."client_id"`
      const channelId = identifier("ch")
      const consentId = identifier("cg")
      const consentTextVersion = clientConsentVersion(input.language)
      const identity =
        input.identity.kind === "telegram"
          ? {
              channelKind: input.identity.kind,
              address: input.identity.userId,
              snapshot: JSON.stringify({
                name: input.identity.name,
                ...(input.identity.username === undefined
                  ? {}
                  : { username: input.identity.username }),
              }),
              clientProfile: sql`
                update "client"
                set "language" = ${input.language}, "updated_at" = ${input.now}
                from "claimed"
                where "client"."id" = "claimed"."client_id"
                returning "client"."id"
              `,
            }
          : {
              channelKind: input.identity.kind,
              address: input.identity.address,
              snapshot: JSON.stringify({ name: input.identity.clientName }),
              clientProfile: sql`
                update "client"
                set
                  "language" = ${input.language},
                  "google_sub" = coalesce(${input.identity.googleSub ?? null}, "client"."google_sub"),
                  "updated_at" = ${input.now}
                from "claimed"
                where "client"."id" = "claimed"."client_id"
                returning "client"."id"
              `,
            }

      const result = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            with "claimed" as (
              update "invite"
              set "status" = 'accepted'
              where
                "id" = ${input.inviteId}
                and "workspace_id" = ${input.workspaceId}
                and "status" = 'pending'
              returning "id", "client_id", "workspace_id"
            ),
            "client_profile" as (
              ${identity.clientProfile}
            ),
            "channel_created" as (
              insert into "channel" (
                "id", "client_id", "kind", "address", "is_primary", "snapshot",
                "created_at", "updated_at"
              )
              select
                ${channelId}, "claimed"."client_id", ${identity.channelKind}, ${identity.address},
                true, ${identity.snapshot}::jsonb, ${input.now}, ${input.now}
              from "claimed"
              returning "id"
            ),
            "consent_created" as (
              insert into "consent_grant" (
                "id", "client_id", "scope", "revoked", "text_version", "channel_kind", "granted_at"
              )
              select
                ${consentId}, "claimed"."client_id", 'recording_and_processing', false,
                ${consentTextVersion}, ${identity.channelKind}, ${input.now}
              from "claimed"
              returning "id"
            ),
            "coach" as (
              select
                "m"."telegram_user_id" as "recipient",
                "claimed"."workspace_id" as "workspace_id",
                "claimed"."client_id" as "client_id"
              from "claimed"
              join "member" as "m" on "m"."workspace_id" = "claimed"."workspace_id"
              where "m"."role" = 'owner' and "m"."telegram_user_id" is not null
            ),
            "queued_notification" as (
              insert into "coach_bot_notification" (
                "id", "workspace_id", "kind", "dedupe_key", "recipient_telegram_id",
                "recipient_role", "status", "attempt_count", "available_at",
                "created_at", "updated_at"
              )
              select
                ${CoachNotification.id(kind, workspaceId, clientId)},
                "coach"."workspace_id",
                ${kind},
                ${CoachNotification.dedupeKey(kind, workspaceId, clientId)},
                "coach"."recipient",
                ${CoachNotification.Role.Coach},
                'pending', 0, ${input.now}, ${input.now}, ${input.now}
              from "coach"
              on conflict ("dedupe_key") do nothing
            )
            select "client_id" from "claimed"
          `),
        catch: (cause) => new QueryFailed({ operation: "clientAcceptance.claim", cause }),
      })

      return { accepted: result.rows.length > 0 }
    })

    /**
     * The coach behind one bot. Read by `/start` before it decides which of its
     * three answers this sender gets: the coach's own menu, or the sentence that
     * names whose assistant they have just messaged.
     */
    const findBotOwner = Effect.fn("ClientAcceptanceRepo.findBotOwner")(function* (
      telegramBotId: string,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              workspaceId: schema.workspace.id,
              workspaceName: schema.workspace.name,
              coachTelegramId: schema.member.telegramUserId,
              coachLanguage: schema.member.language,
            })
            .from(schema.bot)
            .innerJoin(schema.workspace, eq(schema.workspace.id, schema.bot.workspaceId))
            .innerJoin(
              schema.member,
              sql`${schema.member.workspaceId} = ${schema.bot.workspaceId} and ${schema.member.role} = 'owner'`,
            )
            .where(eq(schema.bot.telegramBotId, telegramBotId))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "clientAcceptance.findBotOwner", cause }),
      })
      const row = rows[0]
      if (row === undefined) return undefined
      return {
        workspaceId: row.workspaceId,
        workspaceName: row.workspaceName,
        ...(row.coachTelegramId === null ? {} : { coachTelegramId: row.coachTelegramId }),
        coachLanguage: row.coachLanguage,
      } satisfies BotOwner
    })

    /**
     * One accepted client, as the coach's own push describes them: the name they
     * were created under, the Telegram account that accepted, the language they
     * chose, and the session already on the books if there is one.
     */
    const findAcceptedClient = Effect.fn("ClientAcceptanceRepo.findAcceptedClient")(function* (
      clientId: string,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            select
              "c"."id" as "id",
              "c"."name" as "name",
              "c"."language" as "language",
              "ch"."snapshot" as "snapshot",
              ${isoColumn('"s"."scheduled_at"')} as "session_at"
            from "client" as "c"
            left join "channel" as "ch"
              on "ch"."client_id" = "c"."id" and "ch"."is_primary"
            left join lateral (
              select "scheduled_at"
              from "session"
              where "session"."client_id" = "c"."id" and "session"."state" = 'scheduled'
              order by "session"."scheduled_at" asc
              limit 1
            ) as "s" on true
            where "c"."id" = ${clientId}
            limit 1
          `),
        catch: (cause) =>
          new QueryFailed({ operation: "clientAcceptance.findAcceptedClient", cause }),
      })

      const record = rows.rows[0] as Record<string, unknown> | undefined
      if (record === undefined) return undefined
      const snapshot = record.snapshot as {
        readonly name?: string
        readonly username?: string
      } | null
      const chosen = readLanguage(record.language)
      const sessionAt = readDate(record.session_at)

      return {
        id: String(record.id),
        name: String(record.name),
        ...(chosen === undefined ? {} : { language: chosen }),
        ...(snapshot?.name === undefined ? {} : { telegramName: snapshot.name }),
        ...(snapshot?.username === undefined ? {} : { telegramUsername: snapshot.username }),
        ...(sessionAt === undefined ? {} : { nextSessionAt: sessionAt }),
      } satisfies AcceptedClient
    })

    return Service.of({
      findByToken,
      findByWebToken,
      findBotOwner,
      findAcceptedClient,
      claim,
    })
  }),
)

export * as ClientAcceptanceRepo from "./client-acceptance-repo.ts"
