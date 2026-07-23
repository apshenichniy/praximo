import {
  CoachLanguage,
  CoachOnboardingInviteId,
  CoachOnboardingInviteStatus,
  WorkspaceId,
} from "@praximo/domain"
import { and, eq, gt, sql } from "drizzle-orm"
import { Context, Effect, Layer, Result, Schema } from "effect"
import { Database, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

export const InviteTtlMilliseconds = 7 * 24 * 60 * 60 * 1_000

export interface CreateInput {
  readonly requestId: string
  readonly requestFingerprint: string
  readonly name: string
  readonly coachLanguage: CoachLanguage
  readonly avatarR2Key?: string
  readonly description?: string
  readonly shortDescription?: string
  readonly issuedByTelegramId: string
  readonly now: Date
}

const InviteSchema = Schema.Struct({
  id: CoachOnboardingInviteId,
  workspaceId: WorkspaceId,
  status: CoachOnboardingInviteStatus,
  issuedAt: Schema.instanceOf(Date),
  expiresAt: Schema.instanceOf(Date),
  usedAt: Schema.optionalKey(Schema.instanceOf(Date)),
  issuedByTelegramId: Schema.String,
})

const AggregateSchema = Schema.Struct({
  workspace: Schema.Struct({
    id: WorkspaceId,
    name: Schema.NonEmptyString,
    avatarR2Key: Schema.optionalKey(Schema.NonEmptyString),
    description: Schema.optionalKey(Schema.String),
    shortDescription: Schema.optionalKey(Schema.String),
  }),
  owner: Schema.Struct({
    language: CoachLanguage,
    telegramUserId: Schema.optionalKey(Schema.String),
  }),
  invite: InviteSchema,
})

export interface Aggregate extends Schema.Schema.Type<typeof AggregateSchema> {}

export interface CreateOutcome {
  readonly aggregate: Aggregate
  readonly created: boolean
}

export interface ReissueInput {
  readonly workspaceId: WorkspaceId
  readonly expectedInviteId: CoachOnboardingInviteId
  readonly requestId: string
  readonly issuedByTelegramId: string
  readonly now: Date
}

export interface Interface {
  readonly lookupCreate: (
    input: CreateInput,
  ) => Effect.Effect<CreateOutcome | undefined, IdempotencyConflict | QueryFailed>
  readonly createOrGet: (
    input: CreateInput,
  ) => Effect.Effect<CreateOutcome, IdempotencyConflict | QueryFailed>
  readonly findInvite: (
    id: CoachOnboardingInviteId,
  ) => Effect.Effect<Aggregate, InviteUnavailable | QueryFailed>
  readonly verifyPending: (
    id: CoachOnboardingInviteId,
    now: Date,
  ) => Effect.Effect<Aggregate, InviteUnavailable | QueryFailed>
  readonly markUsed: (
    id: CoachOnboardingInviteId,
    now: Date,
  ) => Effect.Effect<Aggregate["invite"], InviteUnavailable | QueryFailed>
  readonly reissue: (
    input: ReissueInput,
  ) => Effect.Effect<Aggregate, IdempotencyConflict | ReissueUnavailable | QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/db/CoachOnboardingRepo",
) {}

export class IdempotencyConflict extends Schema.TaggedErrorClass<IdempotencyConflict>()(
  "CoachOnboardingRepo.IdempotencyConflict",
  {
    requestId: Schema.String,
    existingAvatarR2Key: Schema.optionalKey(Schema.String),
  },
) {}

export class InviteUnavailable extends Schema.TaggedErrorClass<InviteUnavailable>()(
  "CoachOnboardingRepo.InviteUnavailable",
  {
    id: CoachOnboardingInviteId,
    reason: Schema.Literals(["not-found", "expired", "used"]),
  },
) {}

export class ReissueUnavailable extends Schema.TaggedErrorClass<ReissueUnavailable>()(
  "CoachOnboardingRepo.ReissueUnavailable",
  {
    workspaceId: WorkspaceId,
  },
) {}

const idsFor = (requestId: string) => {
  const compact = requestId.replaceAll("-", "")
  return {
    workspaceId: WorkspaceId.make(`ws_${compact}`),
    memberId: `mem_${compact}`,
    inviteId: CoachOnboardingInviteId.make(`ci_${compact.slice(0, 26)}`),
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service
    const decodeAggregate = Schema.decodeUnknownEffect(AggregateSchema)
    const decodeInvite = Schema.decodeUnknownEffect(InviteSchema)

    const loadByInviteId = Effect.fn("CoachOnboardingRepo.loadByInviteId")(function* (
      id: CoachOnboardingInviteId,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              inviteId: schema.coachOnboardingInvite.id,
              workspaceId: schema.workspace.id,
              status: schema.coachOnboardingInvite.status,
              issuedAt: schema.coachOnboardingInvite.issuedAt,
              expiresAt: schema.coachOnboardingInvite.expiresAt,
              usedAt: schema.coachOnboardingInvite.usedAt,
              issuedByTelegramId: schema.coachOnboardingInvite.issuedByTelegramId,
              name: schema.workspace.name,
              avatarR2Key: schema.workspace.avatarR2Key,
              description: schema.workspace.description,
              shortDescription: schema.workspace.shortDescription,
              language: schema.member.language,
              telegramUserId: schema.member.telegramUserId,
            })
            .from(schema.coachOnboardingInvite)
            .innerJoin(
              schema.workspace,
              eq(schema.workspace.id, schema.coachOnboardingInvite.workspaceId),
            )
            .innerJoin(
              schema.member,
              and(
                eq(schema.member.workspaceId, schema.workspace.id),
                eq(schema.member.role, "owner"),
              ),
            )
            .where(eq(schema.coachOnboardingInvite.id, id))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "loadByInviteId", cause }),
      })
      const row = rows[0]
      if (row === undefined) return undefined

      return yield* decodeAggregate({
        workspace: {
          id: row.workspaceId,
          name: row.name,
          ...(row.avatarR2Key === null ? {} : { avatarR2Key: row.avatarR2Key }),
          ...(row.description === null ? {} : { description: row.description }),
          ...(row.shortDescription === null ? {} : { shortDescription: row.shortDescription }),
        },
        owner: {
          language: row.language,
          ...(row.telegramUserId === null ? {} : { telegramUserId: row.telegramUserId }),
        },
        invite: {
          id: row.inviteId,
          workspaceId: row.workspaceId,
          status: row.status,
          issuedAt: row.issuedAt,
          expiresAt: row.expiresAt,
          ...(row.usedAt === null ? {} : { usedAt: row.usedAt }),
          issuedByTelegramId: row.issuedByTelegramId,
        },
      }).pipe(
        Effect.mapError((cause) => new QueryFailed({ operation: "loadByInviteId.decode", cause })),
      )
    })

    const loadByRequestId = Effect.fn("CoachOnboardingRepo.loadByRequestId")(function* (
      requestId: string,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              id: schema.coachOnboardingInvite.id,
              fingerprint: schema.coachOnboardingInvite.requestFingerprint,
            })
            .from(schema.coachOnboardingInvite)
            .where(eq(schema.coachOnboardingInvite.requestId, requestId))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "loadByRequestId", cause }),
      })
      const row = rows[0]
      if (row === undefined) return undefined
      const aggregate = yield* loadByInviteId(CoachOnboardingInviteId.make(row.id))
      return aggregate === undefined ? undefined : { aggregate, fingerprint: row.fingerprint }
    })

    const resolveReplay = (
      existing: { readonly aggregate: Aggregate; readonly fingerprint: string },
      input: CreateInput,
    ): Effect.Effect<CreateOutcome, IdempotencyConflict> =>
      existing.fingerprint === input.requestFingerprint
        ? Effect.succeed({ aggregate: existing.aggregate, created: false })
        : Effect.fail(
            new IdempotencyConflict({
              requestId: input.requestId,
              ...(existing.aggregate.workspace.avatarR2Key === undefined
                ? {}
                : { existingAvatarR2Key: existing.aggregate.workspace.avatarR2Key }),
            }),
          )

    const lookupCreate = Effect.fn("CoachOnboardingRepo.lookupCreate")(function* (
      input: CreateInput,
    ) {
      const existing = yield* loadByRequestId(input.requestId)
      return existing === undefined ? undefined : yield* resolveReplay(existing, input)
    })

    const createOrGet = Effect.fn("CoachOnboardingRepo.createOrGet")(function* (
      input: CreateInput,
    ) {
      const existing = yield* lookupCreate(input)
      if (existing !== undefined) return existing

      const { workspaceId, memberId, inviteId } = idsFor(input.requestId)
      const expiresAt = new Date(input.now.getTime() + InviteTtlMilliseconds)
      const inserted = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            with inserted_workspace as (
              insert into "workspace" (
                "id",
                "name",
                "avatar_r2_key",
                "description",
                "short_description"
              )
              values (
                ${workspaceId},
                ${input.name},
                ${input.avatarR2Key ?? null},
                ${input.description ?? null},
                ${input.shortDescription ?? null}
              )
              on conflict ("id") do nothing
              returning "id"
            ),
            inserted_member as (
              insert into "member" (
                "id",
                "workspace_id",
                "role",
                "language",
                "telegram_user_id"
              )
              select
                ${memberId},
                "id",
                'owner',
                ${input.coachLanguage}::language,
                null
              from inserted_workspace
              returning "id"
            )
            insert into "coach_onboarding_invite" (
              "id",
              "workspace_id",
              "request_id",
              "request_fingerprint",
              "issued_by_telegram_id",
              "issued_at",
              "expires_at"
            )
            select
              ${inviteId},
              "id",
              ${input.requestId},
              ${input.requestFingerprint},
              ${input.issuedByTelegramId},
              ${input.now},
              ${expiresAt}
            from inserted_workspace
            returning "id"
          `),
        catch: (cause) => new QueryFailed({ operation: "createOrGet.transaction", cause }),
      }).pipe(Effect.result)

      if (Result.isFailure(inserted)) {
        const replay = yield* loadByRequestId(input.requestId)
        if (replay !== undefined) return yield* resolveReplay(replay, input)
        return yield* inserted.failure
      }

      if (inserted.success.rows.length === 0) {
        const replay = yield* loadByRequestId(input.requestId)
        if (replay !== undefined) return yield* resolveReplay(replay, input)
        return yield* new QueryFailed({
          operation: "createOrGet.replay",
          cause: new Error("insert was a no-op but the existing aggregate was not found"),
        })
      }

      const aggregate = yield* loadByInviteId(inviteId)
      if (aggregate === undefined) {
        return yield* new QueryFailed({
          operation: "createOrGet.load",
          cause: new Error("created aggregate was not found"),
        })
      }
      return { aggregate, created: true }
    })

    const findInvite = Effect.fn("CoachOnboardingRepo.findInvite")(function* (
      id: CoachOnboardingInviteId,
    ) {
      const aggregate = yield* loadByInviteId(id)
      if (aggregate === undefined) {
        return yield* new InviteUnavailable({ id, reason: "not-found" })
      }
      return aggregate
    })

    const markUsed = Effect.fn("CoachOnboardingRepo.markUsed")(function* (
      id: CoachOnboardingInviteId,
      now: Date,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.coachOnboardingInvite)
            .set({ status: "used", usedAt: now })
            .where(
              and(
                eq(schema.coachOnboardingInvite.id, id),
                eq(schema.coachOnboardingInvite.status, "pending"),
                gt(schema.coachOnboardingInvite.expiresAt, now),
              ),
            )
            .returning({
              workspaceId: schema.coachOnboardingInvite.workspaceId,
              status: schema.coachOnboardingInvite.status,
              issuedAt: schema.coachOnboardingInvite.issuedAt,
              expiresAt: schema.coachOnboardingInvite.expiresAt,
              usedAt: schema.coachOnboardingInvite.usedAt,
              issuedByTelegramId: schema.coachOnboardingInvite.issuedByTelegramId,
            }),
        catch: (cause) => new QueryFailed({ operation: "markUsed", cause }),
      })
      const row = rows[0]
      if (row !== undefined) {
        return yield* decodeInvite({
          id,
          workspaceId: row.workspaceId,
          status: row.status,
          issuedAt: row.issuedAt,
          expiresAt: row.expiresAt,
          ...(row.usedAt === null ? {} : { usedAt: row.usedAt }),
          issuedByTelegramId: row.issuedByTelegramId,
        }).pipe(
          Effect.mapError((cause) => new QueryFailed({ operation: "markUsed.decode", cause })),
        )
      }

      const aggregate = yield* findInvite(id)
      const reason = aggregate.invite.status === "used" ? "used" : "expired"
      if (reason === "expired" && aggregate.invite.status === "pending") {
        yield* Effect.tryPromise({
          try: () =>
            client
              .update(schema.coachOnboardingInvite)
              .set({ status: "expired" })
              .where(
                and(
                  eq(schema.coachOnboardingInvite.id, id),
                  eq(schema.coachOnboardingInvite.status, "pending"),
                ),
              ),
          catch: (cause) => new QueryFailed({ operation: "markUsed.expire", cause }),
        })
      }
      return yield* new InviteUnavailable({ id, reason })
    })

    const verifyPending = Effect.fn("CoachOnboardingRepo.verifyPending")(function* (
      id: CoachOnboardingInviteId,
      now: Date,
    ) {
      const aggregate = yield* findInvite(id)
      if (aggregate.invite.status === "used") {
        return yield* new InviteUnavailable({ id, reason: "used" })
      }
      if (
        aggregate.invite.status === "expired" ||
        aggregate.invite.expiresAt.getTime() <= now.getTime()
      ) {
        return yield* new InviteUnavailable({ id, reason: "expired" })
      }
      return aggregate
    })

    const reissue = Effect.fn("CoachOnboardingRepo.reissue")(function* (input: ReissueInput) {
      const fingerprint = `reissue:${input.workspaceId}:${input.expectedInviteId}`
      const replay = yield* loadByRequestId(input.requestId)
      if (replay !== undefined) {
        return (yield* resolveReplay(replay, {
          requestId: input.requestId,
          requestFingerprint: fingerprint,
          name: replay.aggregate.workspace.name,
          coachLanguage: replay.aggregate.owner.language,
          issuedByTelegramId: input.issuedByTelegramId,
          now: input.now,
        })).aggregate
      }

      const inviteId = idsFor(input.requestId).inviteId
      const expiresAt = new Date(input.now.getTime() + InviteTtlMilliseconds)
      const inserted = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            with eligible_workspace as (
              select "workspace"."id"
              from "workspace"
              left join "member"
                on "member"."workspace_id" = "workspace"."id"
                and "member"."role" = 'owner'
              left join "bot"
                on "bot"."workspace_id" = "workspace"."id"
              where
                "workspace"."id" = ${input.workspaceId}
                and "member"."telegram_user_id" is null
                and (
                  "bot"."connection_status" is null
                  or "bot"."connection_status" = 'awaiting_setup'
                )
                and not exists (
                  select 1
                  from "coach_onboarding_invite" as "newer_pending"
                  where
                    "newer_pending"."workspace_id" = "workspace"."id"
                    and "newer_pending"."status" = 'pending'
                    and "newer_pending"."id" <> ${input.expectedInviteId}
                )
            ),
            expired_previous as (
              update "coach_onboarding_invite"
              set "status" = 'expired'
              where
                "id" = ${input.expectedInviteId}
                and "workspace_id" = ${input.workspaceId}
                and "status" in ('pending', 'expired')
                and exists (select 1 from eligible_workspace)
              returning "workspace_id"
            )
            insert into "coach_onboarding_invite" (
              "id",
              "workspace_id",
              "request_id",
              "request_fingerprint",
              "issued_by_telegram_id",
              "issued_at",
              "expires_at"
            )
            select
              ${inviteId},
              "workspace_id",
              ${input.requestId},
              ${fingerprint},
              ${input.issuedByTelegramId},
              ${input.now},
              ${expiresAt}
            from expired_previous
            on conflict ("request_id") do nothing
            returning "id"
          `),
        catch: (cause) => new QueryFailed({ operation: "reissue.transaction", cause }),
      }).pipe(Effect.result)

      const reconciled = yield* loadByRequestId(input.requestId)
      if (reconciled !== undefined) {
        return (yield* resolveReplay(reconciled, {
          requestId: input.requestId,
          requestFingerprint: fingerprint,
          name: reconciled.aggregate.workspace.name,
          coachLanguage: reconciled.aggregate.owner.language,
          issuedByTelegramId: input.issuedByTelegramId,
          now: input.now,
        })).aggregate
      }
      if (Result.isFailure(inserted)) return yield* inserted.failure
      return yield* new ReissueUnavailable({ workspaceId: input.workspaceId })
    })

    return Service.of({
      lookupCreate,
      createOrGet,
      findInvite,
      verifyPending,
      markUsed,
      reissue,
    })
  }),
)

export * as CoachOnboardingRepo from "./coach-onboarding-repo.ts"
