import { type CoachLanguage, TelegramId, WorkspaceId } from "@praximo/domain"
import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, QueryFailed } from "./client.ts"
import { CoachNotification } from "./coach-notification.ts"
import * as schema from "./schema.ts"

/**
 * Everything the bot Worker needs to ask Telegram whether a coach bot still
 * answers — and, if it does not, to put it back together (#55).
 *
 * It is one read rather than four because the repair is not a lookup: it
 * re-runs the whole of configuration, so it needs the branding the workspace
 * carries, the coach's own chat for the menu button, and their language for the
 * message that follows.
 */
export interface HealthTarget {
  readonly workspaceId: WorkspaceId
  readonly telegramBotId: string
  readonly username: string
  readonly encryptedToken: string
  /**
   * The secret Telegram currently presents on this bot's webhook, as its hash.
   * A repair that could not re-arm the webhook has to leave this exactly as it
   * is — the row holding a hash of a secret Telegram never accepted is what
   * would answer 401 to the bot's own coach (ADR 0004).
   */
  readonly webhookSecretHash: string
  /**
   * How many outages this bot has already had. The notification composer keys
   * on it, so a repair that follows a re-link is not swallowed by the dedupe
   * row of the outage before it.
   */
  readonly relinkEpisode: number
  /**
   * The workspace owner's Telegram identity, which in their private chat is
   * also the chat id. Absent only for a workspace whose bot connected without
   * binding an owner, which activation does not produce.
   */
  readonly coachTelegramId?: TelegramId
  readonly coachLanguage: CoachLanguage
  /** Shaped as `CoachBotProvisioningRepo.WorkspaceProfile` — configuration's input. */
  readonly workspace: {
    readonly name: string
    readonly avatarR2Key?: string
    readonly description?: string
    readonly shortDescription?: string
  }
}

/**
 * What the conditional flip produced, for the caller that won it. `undefined`
 * from `flagNeedsRelink` means somebody else already flipped this workspace, or
 * it was never connected — either way there is nothing left to announce.
 */
export interface RelinkFlip {
  readonly workspaceId: WorkspaceId
  readonly botUsername: string
  readonly episode: number
}

export interface Interface {
  /**
   * The sweep's batch: connected bots whose last confirmation is older than
   * `staleBefore`, oldest first. Bounded by `limit` so one tick of a
   * five-minute cron cannot become an unbounded fan-out over Telegram.
   */
  readonly dueForCheck: (
    staleBefore: Date,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<HealthTarget>, QueryFailed>
  /** The same row for one workspace — the reactive path's read (#55). */
  readonly findTarget: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<HealthTarget | undefined, QueryFailed>
  /** Telegram answered: this bot is fine, and the sweep can leave it for a day. */
  readonly markChecked: (workspaceId: WorkspaceId, now: Date) => Effect.Effect<void, QueryFailed>
  /**
   * The flip, and the only place one originates.
   *
   * One conditional `update … where connection_status = 'connected' returning`,
   * so exactly one caller wins however many 401s arrive at once — and the
   * notifications it queues are inserted from that same statement, off the row
   * it returned. A repeat does nothing and announces nothing.
   */
  readonly flagNeedsRelink: (
    workspaceId: WorkspaceId,
    now: Date,
  ) => Effect.Effect<RelinkFlip | undefined, QueryFailed>
  /**
   * Tell the coach their bot was repaired without them — once per episode, and
   * nobody else. An admin does not need to hear about an outage that never
   * happened.
   */
  readonly queueRepairNotice: (
    workspaceId: WorkspaceId,
    episode: number,
    now: Date,
  ) => Effect.Effect<void, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/db/CoachBotHealthRepo",
) {}

interface TargetRow {
  workspaceId: string
  telegramBotId: string | null
  username: string | null
  token: string | null
  webhookSecretHash: string | null
  relinkEpisode: number
  coachTelegramId: string | null
  coachLanguage: CoachLanguage
  workspaceName: string
  avatarR2Key: string | null
  description: string | null
  shortDescription: string | null
}

const toTarget = (row: TargetRow): HealthTarget | undefined =>
  row.telegramBotId === null ||
  row.username === null ||
  row.token === null ||
  row.webhookSecretHash === null
    ? undefined
    : {
        workspaceId: WorkspaceId.make(row.workspaceId),
        telegramBotId: row.telegramBotId,
        username: row.username,
        encryptedToken: row.token,
        webhookSecretHash: row.webhookSecretHash,
        relinkEpisode: row.relinkEpisode,
        ...(row.coachTelegramId === null
          ? {}
          : { coachTelegramId: TelegramId.make(row.coachTelegramId) }),
        coachLanguage: row.coachLanguage,
        workspace: {
          name: row.workspaceName,
          ...(row.avatarR2Key === null ? {} : { avatarR2Key: row.avatarR2Key }),
          ...(row.description === null ? {} : { description: row.description }),
          ...(row.shortDescription === null ? {} : { shortDescription: row.shortDescription }),
        },
      }

/**
 * A workspace whose deletion is already prepared. Probing one would repair a bot
 * that is about to be released, and flipping one would tell a coach and an admin
 * about an outage in a workspace that is being purged.
 */
const deletionPrepared = sql`exists (
  select 1 from "workspace_deletion_operation" as "deletion"
  where
    "deletion"."workspace_id" = ${schema.bot.workspaceId}
    and "deletion"."state" = 'prepared'
)`

/**
 * The `bot` table's health concerns: what the sweep reads, what a successful
 * probe writes, and the single conditional statement a flip to `needs_relink`
 * originates from (#55).
 *
 * Separate from `CoachBotProvisioningRepo`, which owns how a bot *becomes*
 * installed, because this owns what happens to one afterwards — and because the
 * flip has to be one statement that both takes the transition and queues its two
 * pushes. Like the other writers of `coach_bot_notification`, it composes them
 * through `CoachNotification` rather than restating the conventions.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    const targetProjection = {
      workspaceId: schema.bot.workspaceId,
      telegramBotId: schema.bot.telegramBotId,
      username: schema.bot.username,
      token: schema.bot.token,
      webhookSecretHash: schema.bot.webhookSecretHash,
      relinkEpisode: schema.bot.relinkEpisode,
      coachTelegramId: schema.member.telegramUserId,
      coachLanguage: schema.member.language,
      workspaceName: schema.workspace.name,
      avatarR2Key: schema.workspace.avatarR2Key,
      description: schema.workspace.description,
      shortDescription: schema.workspace.shortDescription,
    }

    const targetQuery = () =>
      client
        .select(targetProjection)
        .from(schema.bot)
        .innerJoin(schema.workspace, eq(schema.workspace.id, schema.bot.workspaceId))
        .innerJoin(
          schema.member,
          and(
            eq(schema.member.workspaceId, schema.bot.workspaceId),
            eq(schema.member.role, "owner"),
          ),
        )

    const dueForCheck = Effect.fn("CoachBotHealthRepo.dueForCheck")(function* (
      staleBefore: Date,
      limit: number,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          targetQuery()
            .where(
              and(
                eq(schema.bot.connectionStatus, "connected"),
                isNotNull(schema.bot.token),
                isNotNull(schema.bot.telegramBotId),
                isNotNull(schema.bot.username),
                isNotNull(schema.bot.webhookSecretHash),
                or(
                  sql`${schema.bot.healthCheckedAt} is null`,
                  sql`${schema.bot.healthCheckedAt} < ${staleBefore}`,
                ),
                sql`not ${deletionPrepared}`,
              ),
            )
            // Nulls first is the point: a bot connected before this column
            // existed has never been confirmed, and is the one worth asking about.
            .orderBy(
              sql`${schema.bot.healthCheckedAt} asc nulls first`,
              asc(schema.bot.workspaceId),
            )
            .limit(limit),
        catch: (cause) => new QueryFailed({ operation: "botHealth.dueForCheck", cause }),
      })
      return rows.flatMap((row) => {
        const target = toTarget(row)
        return target === undefined ? [] : [target]
      })
    })

    const findTarget = Effect.fn("CoachBotHealthRepo.findTarget")(function* (
      workspaceId: WorkspaceId,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () => targetQuery().where(eq(schema.bot.workspaceId, workspaceId)).limit(1),
        catch: (cause) => new QueryFailed({ operation: "botHealth.findTarget", cause }),
      })
      const row = rows[0]
      return row === undefined ? undefined : toTarget(row)
    })

    const markChecked = Effect.fn("CoachBotHealthRepo.markChecked")(function* (
      workspaceId: WorkspaceId,
      now: Date,
    ) {
      yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.bot)
            // Deliberately not `updated_at`: the record did not change, we only
            // learned that it is still true.
            .set({ healthCheckedAt: now })
            .where(eq(schema.bot.workspaceId, workspaceId)),
        catch: (cause) => new QueryFailed({ operation: "botHealth.markChecked", cause }),
      })
    })

    const flagNeedsRelink = Effect.fn("CoachBotHealthRepo.flagNeedsRelink")(function* (
      workspaceId: WorkspaceId,
      now: Date,
    ) {
      const kind = CoachNotification.Kind.NeedsRelink
      const flippedWorkspace = sql`"flipped"."workspace_id"`
      const episode = sql`"flipped"."relink_episode"::text`
      const coach = sql`${CoachNotification.Role.Coach}::text`
      const admin = sql`${CoachNotification.Role.Admin}::text`
      const result = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            with "flipped" as (
              update "bot"
              set
                "connection_status" = 'needs_relink',
                "relink_episode" = "relink_episode" + 1,
                "health_checked_at" = ${now},
                "updated_at" = ${now}
              where "workspace_id" = ${workspaceId} and "connection_status" = 'connected'
              returning "workspace_id", "username", "relink_episode"
            ),
            "coach_push" as (
              insert into "coach_bot_notification" (
                "id", "workspace_id", "kind", "dedupe_key", "recipient_role",
                "recipient_telegram_id", "status", "attempt_count", "available_at",
                "created_at", "updated_at"
              )
              select
                ${CoachNotification.id(kind, flippedWorkspace, episode, coach)},
                "flipped"."workspace_id",
                ${kind},
                ${CoachNotification.dedupeKey(kind, flippedWorkspace, episode, coach)},
                ${CoachNotification.Role.Coach},
                "owner"."telegram_user_id", 'pending', 0,
                ${now}, ${now}, ${now}
              from "flipped"
              join "member" as "owner"
                on "owner"."workspace_id" = "flipped"."workspace_id"
                and "owner"."role" = 'owner'
              -- The coach's own bot is dead by definition, so this rides the
              -- manager bot — which can only reach an identity it already knows.
              where "owner"."telegram_user_id" is not null
              on conflict ("dedupe_key") do nothing
            ),
            "admin_push" as (
              insert into "coach_bot_notification" (
                "id", "workspace_id", "kind", "dedupe_key", "recipient_role",
                "recipient_telegram_id", "status", "attempt_count", "available_at",
                "created_at", "updated_at"
              )
              select
                ${CoachNotification.id(kind, flippedWorkspace, episode, admin)},
                "flipped"."workspace_id",
                ${kind},
                ${CoachNotification.dedupeKey(kind, flippedWorkspace, episode, admin)},
                ${CoachNotification.Role.Admin},
                "issuer"."issued_by_telegram_id", 'pending', 0,
                ${now}, ${now}, ${now}
              from "flipped"
              -- The invite that was actually used, not the newest: a reissue
              -- cancels rather than deletes, so "latest" can name the wrong
              -- issuer. Lateral so a workspace with several historical rows
              -- still yields one recipient.
              join lateral (
                select "invite"."issued_by_telegram_id"
                from "coach_onboarding_invite" as "invite"
                where
                  "invite"."workspace_id" = "flipped"."workspace_id"
                  and "invite"."status" = 'used'
                order by "invite"."used_at" desc nulls last
                limit 1
              ) as "issuer" on true
              on conflict ("dedupe_key") do nothing
            )
            select * from "flipped"
          `),
        catch: (cause) => new QueryFailed({ operation: "botHealth.flagNeedsRelink", cause }),
      })
      const row = result.rows[0] as
        | { workspace_id: string; username: string | null; relink_episode: number }
        | undefined
      if (row === undefined) return undefined
      return {
        workspaceId: WorkspaceId.make(row.workspace_id),
        botUsername: row.username ?? "",
        episode: row.relink_episode,
      } satisfies RelinkFlip
    })

    const queueRepairNotice = Effect.fn("CoachBotHealthRepo.queueRepairNotice")(function* (
      workspaceId: WorkspaceId,
      episode: number,
      now: Date,
    ) {
      const kind = CoachNotification.Kind.BotRepaired
      const workspace = sql`"owner"."workspace_id"`
      const episodeKey = sql`${String(episode)}::text`
      yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            insert into "coach_bot_notification" (
              "id", "workspace_id", "kind", "dedupe_key", "recipient_role",
              "recipient_telegram_id", "status", "attempt_count", "available_at",
              "created_at", "updated_at"
            )
            select
              ${CoachNotification.id(kind, workspace, episodeKey)},
              "owner"."workspace_id",
              ${kind},
              ${CoachNotification.dedupeKey(kind, workspace, episodeKey)},
              ${CoachNotification.Role.Coach},
              "owner"."telegram_user_id", 'pending', 0,
              ${now}, ${now}, ${now}
            from "member" as "owner"
            where
              "owner"."workspace_id" = ${workspaceId}
              and "owner"."role" = 'owner'
              and "owner"."telegram_user_id" is not null
            on conflict ("dedupe_key") do nothing
          `),
        catch: (cause) => new QueryFailed({ operation: "botHealth.queueRepairNotice", cause }),
      })
    })

    return Service.of({
      dueForCheck,
      findTarget,
      markChecked,
      flagNeedsRelink,
      queueRepairNotice,
    })
  }),
)

export * as CoachBotHealthRepo from "./coach-bot-health-repo.ts"
