import type { CoachLanguage } from "@praximo/domain"
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

export interface AcceptInput {
  readonly inviteId: string
  readonly workspaceId: string
  readonly clientId: string
  readonly telegramUserId: string
  readonly telegramName: string
  readonly telegramUsername?: string
  /** The language the client named themselves, one tap before the consent text. */
  readonly language: CoachLanguage
  /** The version derived from the consent text actually shown, in that language. */
  readonly consentTextVersion: string
  readonly channelId: string
  readonly consentId: string
  readonly now: Date
}

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
  readonly findBotOwner: (telegramBotId: string) => Effect.Effect<BotOwner | undefined, QueryFailed>
  readonly findAcceptedClient: (
    clientId: string,
  ) => Effect.Effect<AcceptedClient | undefined, QueryFailed>
  readonly accept: (
    input: AcceptInput,
  ) => Effect.Effect<{ readonly accepted: boolean }, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/db/ClientAcceptanceRepo",
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    /**
     * A token resolves **only inside the workspace of the bot it was presented
     * to**, which is why the bot id is a join condition rather than a check
     * afterwards. A code from another coach's workspace produces no row, and the
     * bot answers that exactly as it answers a stranger's bare `/start` —
     * disclosing neither that the code exists nor whose it is.
     *
     * Expiry is not decided here. The row carries `expires_at` and the caller
     * compares it against its own clock, so this stays a pure read and the three
     * refusals are composed in one place.
     */
    const findByToken = Effect.fn("ClientAcceptanceRepo.findByToken")(function* (
      token: string,
      telegramBotId: string,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
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
            join "bot" as "b"
              on "b"."workspace_id" = "i"."workspace_id"
              and "b"."telegram_bot_id" = ${telegramBotId}
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
          `),
        catch: (cause) => new QueryFailed({ operation: "clientAcceptance.findByToken", cause }),
      })

      const record = rows.rows[0] as Record<string, unknown> | undefined
      if (record === undefined) return undefined

      const delivery = record.delivery as { readonly language?: string } | null
      const sessionAt = readDate(record.session_at)

      return {
        inviteId: String(record.invite_id),
        clientId: String(record.client_id),
        clientName: String(record.client_name),
        workspaceId: String(record.workspace_id),
        status: record.status as InviteLookup["status"],
        expiresAt: readDate(record.expires_at) ?? new Date(0),
        inviteLanguage: readLanguage(delivery?.language) ?? "en",
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
    })

    /**
     * The whole acceptance, in one statement, gated on one conditional update.
     *
     * `where "status" = 'pending'` is the gate, and every other write in here
     * *selects from* that update — so zero rows updated means zero rows
     * everywhere, which is precisely what a losing double tap must produce.
     * There is no interactive transaction available (`client.ts`) and this needs
     * none: a single statement is atomic by itself.
     *
     * The coach's notification is enqueued in the same breath because acceptance
     * is the one event in this whole onboarding that happens without the coach
     * in the room. `on conflict do nothing` keeps a redelivered webhook from
     * queueing it twice.
     */
    const accept = Effect.fn("ClientAcceptanceRepo.accept")(function* (input: AcceptInput) {
      const kind = CoachNotification.Kind.ClientAccepted
      const workspaceId = sql`"coach"."workspace_id"`
      const clientId = sql`"coach"."client_id"`
      const snapshot = JSON.stringify({
        name: input.telegramName,
        ...(input.telegramUsername === undefined ? {} : { username: input.telegramUsername }),
      })

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
            "client_language" as (
              update "client"
              set "language" = ${input.language}, "updated_at" = ${input.now}
              from "claimed"
              where "client"."id" = "claimed"."client_id"
              returning "client"."id"
            ),
            "channel_created" as (
              insert into "channel" (
                "id", "client_id", "kind", "address", "is_primary", "telegram_snapshot",
                "created_at", "updated_at"
              )
              select
                ${input.channelId}, "claimed"."client_id", 'telegram', ${input.telegramUserId},
                true, ${snapshot}::jsonb, ${input.now}, ${input.now}
              from "claimed"
              returning "id"
            ),
            "consent_created" as (
              insert into "consent_grant" (
                "id", "client_id", "scope", "revoked", "text_version", "channel_kind", "granted_at"
              )
              select
                ${input.consentId}, "claimed"."client_id", 'recording_and_processing', false,
                ${input.consentTextVersion}, 'telegram', ${input.now}
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
        catch: (cause) => new QueryFailed({ operation: "clientAcceptance.accept", cause }),
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
              "ch"."telegram_snapshot" as "snapshot",
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

    return Service.of({ findByToken, findBotOwner, findAcceptedClient, accept })
  }),
)

export * as ClientAcceptanceRepo from "./client-acceptance-repo.ts"
