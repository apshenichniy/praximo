import {
  CoachOnboardingInviteId,
  type CoachOnboardingInviteStatus,
  TelegramId,
  WorkspaceId,
} from "@praximo/domain"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

export interface Provisioning {
  readonly id: string
  readonly inviteId: CoachOnboardingInviteId
  readonly workspaceId: WorkspaceId
  readonly coachTelegramId: TelegramId
  readonly keyboardRequestId: number
  readonly managedBotId?: string
  readonly managedBotUsername?: string
  readonly status: "requested" | "configuring" | "completed"
  readonly workspace: {
    readonly name: string
    readonly avatarR2Key?: string
    readonly description?: string
    readonly shortDescription?: string
  }
  readonly issuedByTelegramId: TelegramId
}

export interface Installation {
  readonly workspaceId: WorkspaceId
  readonly telegramBotId: string
  readonly username: string
  readonly encryptedToken: string
  readonly webhookSecretHash: string
  readonly botInfo: unknown
}

export interface PendingNotification {
  readonly id: string
  readonly workspaceId: WorkspaceId
  readonly recipientTelegramId: TelegramId
  readonly workspaceName: string
  readonly botUsername: string
  readonly attemptCount: number
}

export interface WorkspaceProfile {
  readonly name: string
  readonly avatarR2Key?: string
  readonly description?: string
  readonly shortDescription?: string
}

export interface CompleteInput {
  readonly provisioningId: string
  readonly encryptedToken: string
  readonly webhookSecretHash: string
  readonly botInfo: unknown
  readonly now: Date
}

export interface RotateInput {
  readonly telegramBotId: string
  readonly encryptedToken: string
  readonly webhookSecretHash: string
  readonly botInfo: unknown
  readonly username: string
  readonly now: Date
}

export interface Interface {
  readonly prepare: (
    inviteId: CoachOnboardingInviteId,
    coachTelegramId: TelegramId,
    now: Date,
  ) => Effect.Effect<Provisioning, ProvisioningUnavailable | QueryFailed>
  readonly claim: (
    coachTelegramId: TelegramId,
    managedBotId: string,
    managedBotUsername: string,
    now: Date,
  ) => Effect.Effect<Provisioning, ProvisioningUnavailable | QueryFailed>
  readonly complete: (
    input: CompleteInput,
  ) => Effect.Effect<Installation, ProvisioningUnavailable | QueryFailed>
  readonly findByBotId: (
    telegramBotId: string,
  ) => Effect.Effect<Installation, InstallationNotFound | QueryFailed>
  readonly findByWorkspace: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<Installation, InstallationNotFound | QueryFailed>
  readonly workspaceProfile: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<WorkspaceProfile, InstallationNotFound | QueryFailed>
  readonly rotate: (
    input: RotateInput,
  ) => Effect.Effect<Installation, InstallationNotFound | QueryFailed>
  readonly pendingNotifications: (
    now: Date,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<PendingNotification>, QueryFailed>
  readonly markNotificationDelivered: (id: string, now: Date) => Effect.Effect<void, QueryFailed>
  readonly deferNotification: (id: string, now: Date) => Effect.Effect<void, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/db/CoachBotProvisioningRepo",
) {}

export class ProvisioningUnavailable extends Schema.TaggedErrorClass<ProvisioningUnavailable>()(
  "CoachBotProvisioningRepo.ProvisioningUnavailable",
  {
    reason: Schema.Literals([
      "not-found",
      "expired",
      "used",
      "cancelled",
      "claimed",
      "identity-conflict",
    ]),
  },
) {}

/**
 * Whether an invite can still carry a provisioning attempt. An `accepted` claim
 * has no TTL (#112), so only a `pending` invite is measured against its expiry;
 * `cancelled` is the fence a reset raises against an attempt still in flight.
 */
const claimable = (
  invite: { readonly status: CoachOnboardingInviteStatus; readonly expiresAt: Date },
  now: Date,
): boolean =>
  invite.status === "accepted" ||
  (invite.status === "pending" && invite.expiresAt.getTime() > now.getTime())

export class InstallationNotFound extends Schema.TaggedErrorClass<InstallationNotFound>()(
  "CoachBotProvisioningRepo.InstallationNotFound",
  { key: Schema.String },
) {}

const keyboardRequestId = (inviteId: string, coachTelegramId: string): number => {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(`${inviteId}:${coachTelegramId}`)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}

const provisioningId = (inviteId: string, coachTelegramId: string): string =>
  `cbp_${inviteId.slice(3)}_${coachTelegramId}`

const nextAttemptAt = (now: Date, attemptCount: number): Date =>
  new Date(now.getTime() + Math.min(60, 2 ** Math.min(attemptCount, 6)) * 60_000)

const decodeInstallation = (row: {
  workspaceId: string
  telegramBotId: string | null
  username: string | null
  token: string | null
  webhookSecretHash: string | null
  botInfo: unknown
}): Installation | undefined =>
  row.telegramBotId === null ||
  row.username === null ||
  row.token === null ||
  row.webhookSecretHash === null ||
  row.botInfo === null
    ? undefined
    : {
        workspaceId: WorkspaceId.make(row.workspaceId),
        telegramBotId: row.telegramBotId,
        username: row.username,
        encryptedToken: row.token,
        webhookSecretHash: row.webhookSecretHash,
        botInfo: row.botInfo,
      }

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    const loadProvisioning = Effect.fn("CoachBotProvisioningRepo.loadProvisioning")(function* (
      coachTelegramId: TelegramId,
      requestId: number,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              id: schema.coachBotProvisioning.id,
              inviteId: schema.coachBotProvisioning.inviteId,
              workspaceId: schema.coachBotProvisioning.workspaceId,
              coachTelegramId: schema.coachBotProvisioning.coachTelegramId,
              requestId: schema.coachBotProvisioning.keyboardRequestId,
              managedBotId: schema.coachBotProvisioning.managedBotId,
              managedBotUsername: schema.coachBotProvisioning.managedBotUsername,
              status: schema.coachBotProvisioning.status,
              name: schema.workspace.name,
              avatarR2Key: schema.workspace.avatarR2Key,
              description: schema.workspace.description,
              shortDescription: schema.workspace.shortDescription,
              issuedByTelegramId: schema.coachOnboardingInvite.issuedByTelegramId,
            })
            .from(schema.coachBotProvisioning)
            .innerJoin(
              schema.coachOnboardingInvite,
              eq(schema.coachOnboardingInvite.id, schema.coachBotProvisioning.inviteId),
            )
            .innerJoin(
              schema.workspace,
              eq(schema.workspace.id, schema.coachBotProvisioning.workspaceId),
            )
            .where(
              and(
                eq(schema.coachBotProvisioning.coachTelegramId, coachTelegramId),
                eq(schema.coachBotProvisioning.keyboardRequestId, requestId),
              ),
            )
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "provisioning.load", cause }),
      })
      const row = rows[0]
      if (row === undefined) return undefined
      return {
        id: row.id,
        inviteId: CoachOnboardingInviteId.make(row.inviteId),
        workspaceId: WorkspaceId.make(row.workspaceId),
        coachTelegramId: TelegramId.make(row.coachTelegramId),
        keyboardRequestId: row.requestId,
        ...(row.managedBotId === null ? {} : { managedBotId: row.managedBotId }),
        ...(row.managedBotUsername === null ? {} : { managedBotUsername: row.managedBotUsername }),
        status: row.status,
        workspace: {
          name: row.name,
          ...(row.avatarR2Key === null ? {} : { avatarR2Key: row.avatarR2Key }),
          ...(row.description === null ? {} : { description: row.description }),
          ...(row.shortDescription === null ? {} : { shortDescription: row.shortDescription }),
        },
        issuedByTelegramId: TelegramId.make(row.issuedByTelegramId),
      } satisfies Provisioning
    })

    const prepare = Effect.fn("CoachBotProvisioningRepo.prepare")(function* (
      inviteId: CoachOnboardingInviteId,
      coachTelegramId: TelegramId,
      now: Date,
    ) {
      const requestId = keyboardRequestId(inviteId, coachTelegramId)
      yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            insert into "coach_bot_provisioning" (
              "id", "invite_id", "workspace_id", "coach_telegram_id",
              "keyboard_request_id", "status", "created_at", "updated_at"
            )
            select
              ${provisioningId(inviteId, coachTelegramId)},
              "id",
              "workspace_id",
              ${coachTelegramId},
              ${requestId},
              'requested',
              ${now},
              ${now}
            from "coach_onboarding_invite"
            where
              "id" = ${inviteId}
              and (
                "status" = 'accepted'
                or ("status" = 'pending' and "expires_at" > ${now})
              )
            on conflict ("coach_telegram_id", "keyboard_request_id")
            do update set "updated_at" = excluded."updated_at"
          `),
        catch: (cause) => new QueryFailed({ operation: "provisioning.prepare", cause }),
      })
      const prepared = yield* loadProvisioning(coachTelegramId, requestId)
      const inviteRows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              status: schema.coachOnboardingInvite.status,
              expiresAt: schema.coachOnboardingInvite.expiresAt,
            })
            .from(schema.coachOnboardingInvite)
            .where(eq(schema.coachOnboardingInvite.id, inviteId))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "provisioning.prepare.inspect", cause }),
      })
      const invite = inviteRows[0]
      if (prepared !== undefined && invite !== undefined && claimable(invite, now)) {
        return prepared
      }
      return yield* new ProvisioningUnavailable({
        reason:
          invite === undefined
            ? "not-found"
            : invite.status === "used"
              ? "used"
              : invite.status === "cancelled"
                ? "cancelled"
                : invite.status === "expired" || invite.expiresAt.getTime() <= now.getTime()
                  ? "expired"
                  : "claimed",
      })
    })

    const claim = Effect.fn("CoachBotProvisioningRepo.claim")(function* (
      coachTelegramId: TelegramId,
      managedBotId: string,
      managedBotUsername: string,
      now: Date,
    ) {
      yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            update "coach_bot_provisioning" as "candidate"
            set
              "status" = 'configuring',
              "managed_bot_id" = ${managedBotId},
              "managed_bot_username" = ${managedBotUsername},
              "updated_at" = ${now}
            from "coach_onboarding_invite" as "invite"
            where
              "candidate"."invite_id" = "invite"."id"
              and "candidate"."coach_telegram_id" = ${coachTelegramId}
              and "candidate"."id" = (
                select "latest"."id"
                from "coach_bot_provisioning" as "latest"
                where
                  "latest"."coach_telegram_id" = ${coachTelegramId}
                  and "latest"."status" = 'requested'
                order by "latest"."updated_at" desc
                limit 1
              )
              and "candidate"."status" = 'requested'
              and (
                "invite"."status" = 'accepted'
                or ("invite"."status" = 'pending' and "invite"."expires_at" > ${now})
              )
              and not exists (
                select 1
                from "coach_bot_provisioning" as "winner"
                where
                  "winner"."invite_id" = "candidate"."invite_id"
                  and "winner"."status" in ('configuring', 'completed')
              )
          `),
        catch: (cause) => new QueryFailed({ operation: "provisioning.claim", cause }),
      })
      const claimedRows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ requestId: schema.coachBotProvisioning.keyboardRequestId })
            .from(schema.coachBotProvisioning)
            .where(
              and(
                eq(schema.coachBotProvisioning.coachTelegramId, coachTelegramId),
                eq(schema.coachBotProvisioning.managedBotId, managedBotId),
              ),
            )
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "provisioning.claim.inspect", cause }),
      })
      const claimed =
        claimedRows[0] === undefined
          ? undefined
          : yield* loadProvisioning(coachTelegramId, claimedRows[0].requestId)
      if (
        claimed !== undefined &&
        claimed.managedBotId === managedBotId &&
        claimed.status !== "requested"
      ) {
        return claimed
      }
      return yield* new ProvisioningUnavailable({
        reason: claimed === undefined ? "not-found" : "claimed",
      })
    })

    const complete = Effect.fn("CoachBotProvisioningRepo.complete")(function* (
      input: CompleteInput,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            with candidate as (
              select
                "attempt"."id",
                "attempt"."invite_id",
                "attempt"."workspace_id",
                "attempt"."coach_telegram_id",
                "attempt"."managed_bot_id",
                "attempt"."managed_bot_username",
                "invite"."issued_by_telegram_id"
              from "coach_bot_provisioning" as "attempt"
              join "coach_onboarding_invite" as "invite"
                on "invite"."id" = "attempt"."invite_id"
              join "member" as "owner"
                on "owner"."workspace_id" = "attempt"."workspace_id"
                and "owner"."role" = 'owner'
              where
                "attempt"."id" = ${input.provisioningId}
                and "attempt"."status" in ('configuring', 'completed')
                and (
                  "invite"."status" in ('pending', 'accepted')
                  or "attempt"."status" = 'completed'
                )
                and (
                  "owner"."telegram_user_id" is null
                  or "owner"."telegram_user_id" = "attempt"."coach_telegram_id"
                )
            ),
            connected_bot as (
              insert into "bot" (
                "workspace_id", "token", "telegram_bot_id", "username", "bot_info",
                "webhook_secret_hash", "connection_status", "created_at", "updated_at"
              )
              select
                "workspace_id", ${input.encryptedToken}, "managed_bot_id",
                "managed_bot_username", ${JSON.stringify(input.botInfo)}::jsonb,
                ${input.webhookSecretHash}, 'connected', ${input.now}, ${input.now}
              from candidate
              where "managed_bot_id" is not null and "managed_bot_username" is not null
              on conflict ("workspace_id") do update set
                "token" = excluded."token",
                "telegram_bot_id" = excluded."telegram_bot_id",
                "username" = excluded."username",
                "bot_info" = excluded."bot_info",
                "webhook_secret_hash" = excluded."webhook_secret_hash",
                "connection_status" = 'connected',
                "updated_at" = excluded."updated_at"
              returning *
            ),
            claimed_owner as (
              update "member"
              set "telegram_user_id" = candidate."coach_telegram_id", "updated_at" = ${input.now}
              from candidate
              where
                "member"."workspace_id" = candidate."workspace_id"
                and "member"."role" = 'owner'
                and (
                  "member"."telegram_user_id" is null
                  or "member"."telegram_user_id" = candidate."coach_telegram_id"
                )
              returning "member"."workspace_id"
            ),
            consumed_invite as (
              update "coach_onboarding_invite"
              set "status" = 'used', "used_at" = ${input.now}
              from candidate
              where
                "coach_onboarding_invite"."id" = candidate."invite_id"
                and exists (
                  select 1 from claimed_owner
                  where claimed_owner."workspace_id" = candidate."workspace_id"
                )
              returning "coach_onboarding_invite"."id"
            ),
            completed_attempt as (
              update "coach_bot_provisioning"
              set "status" = 'completed', "updated_at" = ${input.now}
              from candidate
              where
                "coach_bot_provisioning"."id" = candidate."id"
                and exists (select 1 from consumed_invite)
              returning candidate.*
            ),
            queued_notification as (
              insert into "coach_bot_notification" (
                "id", "workspace_id", "recipient_telegram_id", "status",
                "attempt_count", "available_at", "created_at", "updated_at"
              )
              select
                'cbn_' || substring("workspace_id" from 4),
                "workspace_id", "issued_by_telegram_id", 'pending', 0,
                ${input.now}, ${input.now}, ${input.now}
              from completed_attempt
              on conflict ("workspace_id") do nothing
            )
            select * from connected_bot
            where exists (select 1 from completed_attempt)
          `),
        catch: (cause) => new QueryFailed({ operation: "provisioning.complete", cause }),
      })
      const row = rows.rows[0] as
        | {
            workspace_id: string
            telegram_bot_id: string | null
            username: string | null
            token: string | null
            webhook_secret_hash: string | null
            bot_info: unknown
          }
        | undefined
      const installation =
        row === undefined
          ? undefined
          : decodeInstallation({
              workspaceId: row.workspace_id,
              telegramBotId: row.telegram_bot_id,
              username: row.username,
              token: row.token,
              webhookSecretHash: row.webhook_secret_hash,
              botInfo: row.bot_info,
            })
      if (installation !== undefined) return installation
      return yield* new ProvisioningUnavailable({ reason: "identity-conflict" })
    })

    const loadInstallation = Effect.fn("CoachBotProvisioningRepo.loadInstallation")(function* (
      key: string,
      column: "bot" | "workspace",
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              workspaceId: schema.bot.workspaceId,
              telegramBotId: schema.bot.telegramBotId,
              username: schema.bot.username,
              token: schema.bot.token,
              webhookSecretHash: schema.bot.webhookSecretHash,
              botInfo: schema.bot.botInfo,
            })
            .from(schema.bot)
            .where(
              column === "bot"
                ? eq(schema.bot.telegramBotId, key)
                : eq(schema.bot.workspaceId, key),
            )
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "installation.load", cause }),
      })
      const installation = rows[0] === undefined ? undefined : decodeInstallation(rows[0])
      return installation === undefined ? yield* new InstallationNotFound({ key }) : installation
    })

    const findByBotId = (id: string) => loadInstallation(id, "bot")
    const findByWorkspace = (id: WorkspaceId) => loadInstallation(id, "workspace")

    const workspaceProfile = Effect.fn("CoachBotProvisioningRepo.workspaceProfile")(function* (
      workspaceId: WorkspaceId,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              name: schema.workspace.name,
              avatarR2Key: schema.workspace.avatarR2Key,
              description: schema.workspace.description,
              shortDescription: schema.workspace.shortDescription,
            })
            .from(schema.workspace)
            .where(eq(schema.workspace.id, workspaceId))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "workspace.profile", cause }),
      })
      const row = rows[0]
      if (row === undefined) return yield* new InstallationNotFound({ key: workspaceId })
      return {
        name: row.name,
        ...(row.avatarR2Key === null ? {} : { avatarR2Key: row.avatarR2Key }),
        ...(row.description === null ? {} : { description: row.description }),
        ...(row.shortDescription === null ? {} : { shortDescription: row.shortDescription }),
      } satisfies WorkspaceProfile
    })

    const rotate = Effect.fn("CoachBotProvisioningRepo.rotate")(function* (input: RotateInput) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.bot)
            .set({
              token: input.encryptedToken,
              username: input.username,
              botInfo: input.botInfo,
              webhookSecretHash: input.webhookSecretHash,
              updatedAt: input.now,
            })
            .where(eq(schema.bot.telegramBotId, input.telegramBotId))
            .returning({
              workspaceId: schema.bot.workspaceId,
              telegramBotId: schema.bot.telegramBotId,
              username: schema.bot.username,
              token: schema.bot.token,
              webhookSecretHash: schema.bot.webhookSecretHash,
              botInfo: schema.bot.botInfo,
            }),
        catch: (cause) => new QueryFailed({ operation: "installation.rotate", cause }),
      })
      const installation = rows[0] === undefined ? undefined : decodeInstallation(rows[0])
      return installation === undefined
        ? yield* new InstallationNotFound({ key: input.telegramBotId })
        : installation
    })

    const pendingNotifications = Effect.fn("CoachBotProvisioningRepo.pendingNotifications")(
      function* (now: Date, limit: number) {
        const leaseUntil = new Date(now.getTime() + 5 * 60_000)
        const result = yield* Effect.tryPromise({
          try: () =>
            client.execute(sql`
            with candidates as (
              select "id"
              from "coach_bot_notification"
              where "status" = 'pending' and "available_at" <= ${now}
              order by "available_at"
              limit ${limit}
              for update skip locked
            ),
            claimed as (
              update "coach_bot_notification" as "notification"
              set
                "attempt_count" = "notification"."attempt_count" + 1,
                "available_at" = ${leaseUntil},
                "updated_at" = ${now}
              from candidates
              where "notification"."id" = candidates."id"
              returning "notification".*
            )
            select
              claimed."id",
              claimed."workspace_id",
              claimed."recipient_telegram_id",
              claimed."attempt_count",
              "workspace"."name" as "workspace_name",
              "bot"."username" as "bot_username"
            from claimed
            join "workspace" on "workspace"."id" = claimed."workspace_id"
            join "bot" on "bot"."workspace_id" = claimed."workspace_id"
          `),
          catch: (cause) => new QueryFailed({ operation: "notification.pending", cause }),
        })
        return (
          result.rows as unknown as ReadonlyArray<{
            id: string
            workspace_id: string
            recipient_telegram_id: string
            workspace_name: string
            bot_username: string | null
            attempt_count: number
          }>
        ).flatMap((row) =>
          row.bot_username === null
            ? []
            : [
                {
                  id: row.id,
                  workspaceId: WorkspaceId.make(row.workspace_id),
                  recipientTelegramId: TelegramId.make(row.recipient_telegram_id),
                  workspaceName: row.workspace_name,
                  botUsername: row.bot_username,
                  attemptCount: row.attempt_count,
                } satisfies PendingNotification,
              ],
        )
      },
    )

    const markNotificationDelivered = Effect.fn(
      "CoachBotProvisioningRepo.markNotificationDelivered",
    )(function* (id: string, now: Date) {
      yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.coachBotNotification)
            .set({ status: "delivered", deliveredAt: now, updatedAt: now })
            .where(eq(schema.coachBotNotification.id, id)),
        catch: (cause) => new QueryFailed({ operation: "notification.delivered", cause }),
      })
    })

    const deferNotification = Effect.fn("CoachBotProvisioningRepo.deferNotification")(function* (
      id: string,
      now: Date,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ attemptCount: schema.coachBotNotification.attemptCount })
            .from(schema.coachBotNotification)
            .where(eq(schema.coachBotNotification.id, id))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "notification.defer.load", cause }),
      })
      const attemptCount = rows[0]?.attemptCount ?? 1
      yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.coachBotNotification)
            .set({
              availableAt: nextAttemptAt(now, attemptCount),
              updatedAt: now,
            })
            .where(eq(schema.coachBotNotification.id, id)),
        catch: (cause) => new QueryFailed({ operation: "notification.defer", cause }),
      })
    })

    return Service.of({
      prepare,
      claim,
      complete,
      findByBotId,
      findByWorkspace,
      workspaceProfile,
      rotate,
      pendingNotifications,
      markNotificationDelivered,
      deferNotification,
    })
  }),
)

export * as CoachBotProvisioningRepo from "./coach-bot-provisioning-repo.ts"
