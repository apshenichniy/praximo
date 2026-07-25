import { type CoachLanguage, TelegramId, WorkspaceId } from "@praximo/domain"
import { and, eq, isNotNull, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { type BotConnectionStatus, botConnectionStatus } from "./bot-connection-status.ts"
import { Database, QueryFailed } from "./client.ts"
import { CoachNotification } from "./coach-notification.ts"
import * as schema from "./schema.ts"

/**
 * Everything an authenticated coach launch needs about the member it resolved
 * to, read in one query so verification costs a single round trip.
 *
 * `botUsername` and `telegramBotId` are required rather than optional: both are
 * written by the same activation that binds the owner, and the coach's own home
 * screen quotes them back. A bot row missing either is not a launchable coach
 * workspace, so it is filtered out here instead of being surfaced half-formed.
 */
export interface CoachPrincipalRow {
  readonly memberId: string
  readonly workspaceId: WorkspaceId
  readonly language: CoachLanguage
  readonly botUsername: string
  readonly telegramBotId: string
  /**
   * Whether that bot still answers. The coach entry reads it because a broken
   * bot is exactly the state whose only surviving surface is this one: Ed25519
   * launch verification involves no token, and the menu button is Telegram-side
   * state a `/revoke` does not remove, so a coach can still open the Mini App
   * from a bot that can no longer say a word (#55).
   */
  readonly botConnectionStatus: BotConnectionStatus
  readonly termsAcceptedAt?: Date
  readonly termsVersion?: string
  readonly credentialsValidFrom?: Date
  /**
   * A prepared, uncompleted workspace deletion. It travels with the principal
   * because the coach's rows outlive the farewell: `CoachBotRelease` only drops
   * the webhook at Telegram, so without this flag a coach mid-deletion would
   * authenticate normally, be told their workspace is active, and be able to
   * accept terms — firing an "onboarding complete" push about a workspace being
   * purged.
   */
  readonly deletionPending: boolean
}

export interface TouchLoginInput {
  readonly memberId: string
  /** The verified `auth_date`, never a server clock reading. */
  readonly authDateMillis: number
}

export interface TouchActivityInput {
  readonly memberId: string
  readonly now: Date
  readonly throttleMillis: number
}

export interface AcceptTermsInput {
  readonly memberId: string
  /** The server's own constant. A caller-supplied string never lands here. */
  readonly version: string
  readonly now: Date
}

export interface Interface {
  readonly findCoachPrincipalByBot: (
    telegramBotId: string,
    telegramUserId: TelegramId,
  ) => Effect.Effect<CoachPrincipalRow | undefined, QueryFailed>
  readonly findCoachPrincipalByIdentity: (
    telegramUserId: TelegramId,
  ) => Effect.Effect<CoachPrincipalRow | undefined, QueryFailed>
  readonly touchLogin: (input: TouchLoginInput) => Effect.Effect<void, QueryFailed>
  readonly touchActivity: (input: TouchActivityInput) => Effect.Effect<void, QueryFailed>
  readonly acceptTerms: (
    input: AcceptTermsInput,
  ) => Effect.Effect<{ readonly accepted: boolean }, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/db/MemberRepo") {}

/**
 * A prepared deletion for this member's workspace. `exists` rather than a join
 * so a workspace with several historical receipts still yields one row.
 */
const deletionPending = sql<boolean>`exists (
  select 1 from "workspace_deletion_operation" as "deletion"
  where
    "deletion"."workspace_id" = ${schema.member.workspaceId}
    and "deletion"."state" = 'prepared'
)`

const principalProjection = {
  memberId: schema.member.id,
  workspaceId: schema.member.workspaceId,
  language: schema.member.language,
  botUsername: schema.bot.username,
  telegramBotId: schema.bot.telegramBotId,
  botConnectionStatus: schema.bot.connectionStatus,
  termsAcceptedAt: schema.member.termsAcceptedAt,
  termsVersion: schema.member.termsVersion,
  credentialsValidFrom: schema.member.credentialsValidFrom,
  deletionPending,
}

const toPrincipal = (row: {
  memberId: string
  workspaceId: string
  language: CoachLanguage
  botUsername: string | null
  telegramBotId: string | null
  botConnectionStatus: string
  termsAcceptedAt: Date | null
  termsVersion: string | null
  credentialsValidFrom: Date | null
  deletionPending: boolean
}): CoachPrincipalRow | undefined => {
  if (row.botUsername === null || row.telegramBotId === null) return undefined
  return {
    memberId: row.memberId,
    workspaceId: WorkspaceId.make(row.workspaceId),
    language: row.language,
    botUsername: row.botUsername,
    telegramBotId: row.telegramBotId,
    botConnectionStatus: botConnectionStatus(row.botConnectionStatus),
    ...(row.termsAcceptedAt === null ? {} : { termsAcceptedAt: row.termsAcceptedAt }),
    ...(row.termsVersion === null ? {} : { termsVersion: row.termsVersion }),
    ...(row.credentialsValidFrom === null
      ? {}
      : { credentialsValidFrom: row.credentialsValidFrom }),
    deletionPending: row.deletionPending,
  }
}

/**
 * The `member` table's session concerns: resolving a verified launch to a
 * member, the login/activity bookkeeping that launch produces, and the terms
 * acceptance that ends coach onboarding (ADR 0006).
 *
 * It is deliberately *not* the owner of `coach_bot_notification` — that is
 * `CoachBotProvisioningRepo` — yet `acceptTerms` writes one row into it. The
 * neon-http driver has no interactive transactions (`client.ts`), and the
 * acceptance and its admin push have to commit together, so the enqueue lives
 * inside acceptance's own statement. The composition rules it follows are
 * imported from `CoachNotification` rather than restated here.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    /**
     * The ordinary path: the launch named the bot it came from, the signature
     * bound that name, and the member is resolved from the *verified* pair. A
     * borrowed bot id therefore resolves to nothing rather than to someone
     * else's workspace.
     */
    const findCoachPrincipalByBot = Effect.fn("MemberRepo.findCoachPrincipalByBot")(function* (
      telegramBotId: string,
      telegramUserId: TelegramId,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select(principalProjection)
            .from(schema.member)
            .innerJoin(schema.bot, eq(schema.bot.workspaceId, schema.member.workspaceId))
            .where(
              and(
                eq(schema.member.role, "owner"),
                eq(schema.member.telegramUserId, telegramUserId),
                eq(schema.bot.telegramBotId, telegramBotId),
              ),
            )
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "member.findCoachPrincipalByBot", cause }),
      })
      const row = rows[0]
      return row === undefined ? undefined : toPrincipal(row)
    })

    /**
     * The fallback for a launch that carried no bot id: a bot provisioned before
     * the Mini App URL grew its `?b=` parameter, or a Main Mini App the coach
     * configured in @BotFather from a URL they pasted themselves. Single-valued
     * by `member_owner_telegram_user_id_idx` rather than by a tie-break, and the
     * signature still binds the bot — this only costs one indexed probe before
     * verification can name a candidate.
     */
    const findCoachPrincipalByIdentity = Effect.fn("MemberRepo.findCoachPrincipalByIdentity")(
      function* (telegramUserId: TelegramId) {
        const rows = yield* Effect.tryPromise({
          try: () =>
            client
              .select(principalProjection)
              .from(schema.member)
              .innerJoin(schema.bot, eq(schema.bot.workspaceId, schema.member.workspaceId))
              .where(
                and(
                  eq(schema.member.role, "owner"),
                  eq(schema.member.telegramUserId, telegramUserId),
                  isNotNull(schema.bot.telegramBotId),
                ),
              )
              .limit(1),
          catch: (cause) =>
            new QueryFailed({ operation: "member.findCoachPrincipalByIdentity", cause }),
        })
        const row = rows[0]
        return row === undefined ? undefined : toPrincipal(row)
      },
    )

    /**
     * First-login-and-every-login, recorded from the credential's own
     * `auth_date`. The guard makes it monotonic without a read: an out-of-order
     * replay of an older launch cannot walk the timestamp backwards, and two
     * concurrent launches cannot race each other into the wrong order.
     *
     * Neither this nor `touchActivity` bumps `updated_at`. Both columns carry
     * their own timestamp, and letting per-launch bookkeeping move the record's
     * modification time would leave nothing that means "this member changed".
     */
    const touchLogin = Effect.fn("MemberRepo.touchLogin")(function* (input: TouchLoginInput) {
      const authDate = new Date(input.authDateMillis)
      yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.member)
            .set({ lastLoginAt: authDate })
            .where(
              and(
                eq(schema.member.id, input.memberId),
                sql`(${schema.member.lastLoginAt} is null or ${schema.member.lastLoginAt} < ${authDate})`,
              ),
            ),
        catch: (cause) => new QueryFailed({ operation: "member.touchLogin", cause }),
      })
    })

    /**
     * Coarse "last seen", throttled in the statement rather than by a read
     * first: every server call a coach makes would otherwise be two.
     */
    const touchActivity = Effect.fn("MemberRepo.touchActivity")(function* (
      input: TouchActivityInput,
    ) {
      const floor = new Date(input.now.getTime() - input.throttleMillis)
      yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.member)
            .set({ lastActivityAt: input.now })
            .where(
              and(
                eq(schema.member.id, input.memberId),
                sql`(${schema.member.lastActivityAt} is null or ${schema.member.lastActivityAt} < ${floor})`,
              ),
            ),
        catch: (cause) => new QueryFailed({ operation: "member.touchActivity", cause }),
      })
    })

    /**
     * The one write that ends coach onboarding, and the admin push that reports
     * it, in a single statement.
     *
     * Three details are load-bearing. The update is conditional on
     * `terms_accepted_at is null`, so a second acceptance changes nothing and
     * enqueues nothing — the returned `accepted` says which happened. The issuer
     * comes from the invite that was actually *used*, not the newest one: a
     * reissue cancels rather than deletes its predecessor, so "latest by
     * `issued_at`" can name a cancelled invite's issuer. And the join onto it is
     * inner, because a workspace with no used invite must still accept: a `left
     * join` would insert `null` into the NOT NULL recipient column and roll the
     * whole acceptance back over a missing admin push.
     *
     * Residual, accepted: `coach_bot_notification.workspace_id` references
     * `workspace(id)`, so a cascade landing between authentication and this
     * statement raises an FK violation and rolls the acceptance back. The
     * `deletionPending` gate upstream shrinks that to a race of milliseconds and
     * the coach's retry re-enters the same path.
     */
    const acceptTerms = Effect.fn("MemberRepo.acceptTerms")(function* (input: AcceptTermsInput) {
      const kind = CoachNotification.Kind.OnboardingComplete
      const workspaceId = sql`"issuer"."workspace_id"`
      const result = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            with "updated" as (
              update "member"
              set
                "terms_accepted_at" = ${input.now},
                "terms_version" = ${input.version},
                "updated_at" = ${input.now}
              where "id" = ${input.memberId} and "terms_accepted_at" is null
              returning "workspace_id"
            ),
            "issuer" as (
              select "invite"."workspace_id", "invite"."issued_by_telegram_id"
              from "coach_onboarding_invite" as "invite"
              join "updated" on "updated"."workspace_id" = "invite"."workspace_id"
              where "invite"."status" = 'used'
            ),
            "queued_notification" as (
              insert into "coach_bot_notification" (
                "id", "workspace_id", "kind", "dedupe_key", "recipient_telegram_id", "status",
                "attempt_count", "available_at", "created_at", "updated_at"
              )
              select
                ${CoachNotification.id(kind, workspaceId)},
                "issuer"."workspace_id",
                ${kind},
                ${CoachNotification.dedupeKey(kind, workspaceId)},
                "issuer"."issued_by_telegram_id", 'pending', 0,
                ${input.now}, ${input.now}, ${input.now}
              from "issuer"
              on conflict ("dedupe_key") do nothing
            )
            select "workspace_id" from "updated"
          `),
        catch: (cause) => new QueryFailed({ operation: "member.acceptTerms", cause }),
      })
      return { accepted: result.rows.length > 0 }
    })

    return Service.of({
      findCoachPrincipalByBot,
      findCoachPrincipalByIdentity,
      touchLogin,
      touchActivity,
      acceptTerms,
    })
  }),
)

export * as MemberRepo from "./member-repo.ts"
