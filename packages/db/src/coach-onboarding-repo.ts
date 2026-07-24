import {
  CoachLanguage,
  CoachOnboardingInviteCode,
  CoachOnboardingInviteCodeAlphabet,
  CoachOnboardingInviteCodeLength,
  CoachOnboardingInviteId,
  CoachOnboardingInviteStatus,
  InviteDeliveryRecord,
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
  /** Internal label; the workspace row stores "" until the coach names it. */
  readonly name?: string
  /** Owner-member language; defaults to "en" until onboarding sets it. */
  readonly coachLanguage?: CoachLanguage
  readonly avatarR2Key?: string
  readonly description?: string
  readonly shortDescription?: string
  readonly issuedByTelegramId: string
  readonly now: Date
}

const InviteSchema = Schema.Struct({
  id: CoachOnboardingInviteId,
  code: CoachOnboardingInviteCode,
  workspaceId: WorkspaceId,
  status: CoachOnboardingInviteStatus,
  issuedAt: Schema.instanceOf(Date),
  expiresAt: Schema.instanceOf(Date),
  usedAt: Schema.optionalKey(Schema.instanceOf(Date)),
  issuedByTelegramId: Schema.String,
  delivery: Schema.optionalKey(InviteDeliveryRecord),
})

const AggregateSchema = Schema.Struct({
  workspace: Schema.Struct({
    id: WorkspaceId,
    // "" is a real value: an unlabeled invite-first workspace.
    name: Schema.String,
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
  readonly resolveCode: (
    code: CoachOnboardingInviteCode,
  ) => Effect.Effect<CoachOnboardingInviteId, InviteCodeUnresolved | QueryFailed>
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
  readonly recordDelivery: (
    id: CoachOnboardingInviteId,
    delivery: InviteDeliveryRecord,
  ) => Effect.Effect<void, InviteUnavailable | QueryFailed>
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

/**
 * A start-param code passed the format filter but maps to no invite row at all —
 * a made-up code. The caller surfaces the same "invalid link" message as a
 * malformed parameter. A reissue-superseded code is *not* this case: its row
 * survives (expired, not deleted), so `resolveCode` still returns its invite id
 * and provisioning reports it expired.
 */
export class InviteCodeUnresolved extends Schema.TaggedErrorClass<InviteCodeUnresolved>()(
  "CoachOnboardingRepo.InviteCodeUnresolved",
  {
    code: CoachOnboardingInviteCode,
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

/**
 * A fresh start-param code drawn uniformly from the invite-code alphabet.
 * Rejection sampling discards bytes in the biased tail (>= 240 for a 30-symbol
 * alphabet) so every symbol is equally likely. Lives here, next to the unique
 * column and its collision retry, rather than in the platform-neutral domain.
 */
export const generateInviteCode = (): CoachOnboardingInviteCode => {
  const alphabet = CoachOnboardingInviteCodeAlphabet
  const cutoff = Math.floor(256 / alphabet.length) * alphabet.length
  let code = ""
  const bytes = new Uint8Array(CoachOnboardingInviteCodeLength * 2)
  while (code.length < CoachOnboardingInviteCodeLength) {
    crypto.getRandomValues(bytes)
    for (let i = 0; i < bytes.length && code.length < CoachOnboardingInviteCodeLength; i++) {
      const byte = bytes[i] ?? 0
      const symbol = alphabet[byte % alphabet.length]
      if (byte < cutoff && symbol !== undefined) code += symbol
    }
  }
  return CoachOnboardingInviteCode.make(code)
}

/** How many fresh codes to try before giving up on a run of unique collisions. */
const CodeCollisionMaxAttempts = 5

/**
 * A `code` unique-constraint violation. The invite insert is the only statement
 * on these paths without an `on conflict` clause for its unique columns, so a
 * 23505 here is always the `code` colliding — the request-id/id conflicts are
 * absorbed by `do nothing`. Detected so the caller can retry with a fresh code.
 */
const isCodeUniqueViolation = (cause: unknown): boolean => {
  const error = cause as { readonly code?: unknown; readonly constraint?: unknown } | null
  return (
    error?.code === "23505" &&
    (typeof error.constraint !== "string" || error.constraint.includes("code"))
  )
}

/**
 * Run a code-bearing insert, regenerating the code and retrying on the rare
 * `code` collision. Any other failure (or exhausting the attempts) is returned
 * as the {@link Result} failure so the caller's idempotency replay still runs.
 */
const insertWithFreshCode = <A>(
  operation: string,
  run: (code: CoachOnboardingInviteCode) => Promise<A>,
): Effect.Effect<Result.Result<A, QueryFailed>> =>
  Effect.gen(function* () {
    let last: Result.Result<A, QueryFailed> | undefined
    for (let attempt = 0; attempt < CodeCollisionMaxAttempts; attempt++) {
      const code = generateInviteCode()
      last = yield* Effect.tryPromise({
        try: () => run(code),
        catch: (cause) => new QueryFailed({ operation, cause }),
      }).pipe(Effect.result)
      if (Result.isSuccess(last) || !isCodeUniqueViolation(last.failure.cause)) return last
    }
    return (
      last ??
      Result.fail(
        new QueryFailed({
          operation: `${operation}.code-collision`,
          cause: new Error("exhausted invite code attempts"),
        }),
      )
    )
  })

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
              code: schema.coachOnboardingInvite.code,
              workspaceId: schema.workspace.id,
              status: schema.coachOnboardingInvite.status,
              issuedAt: schema.coachOnboardingInvite.issuedAt,
              expiresAt: schema.coachOnboardingInvite.expiresAt,
              usedAt: schema.coachOnboardingInvite.usedAt,
              issuedByTelegramId: schema.coachOnboardingInvite.issuedByTelegramId,
              delivery: schema.coachOnboardingInvite.delivery,
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
          code: row.code,
          workspaceId: row.workspaceId,
          status: row.status,
          issuedAt: row.issuedAt,
          expiresAt: row.expiresAt,
          ...(row.usedAt === null ? {} : { usedAt: row.usedAt }),
          issuedByTelegramId: row.issuedByTelegramId,
          ...(row.delivery === null ? {} : { delivery: row.delivery }),
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
      const inserted = yield* insertWithFreshCode("createOrGet.transaction", (code) =>
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
                ${input.name ?? ""},
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
                ${input.coachLanguage ?? "en"}::language,
                null
              from inserted_workspace
              returning "id"
            )
            insert into "coach_onboarding_invite" (
              "id",
              "code",
              "workspace_id",
              "request_id",
              "request_fingerprint",
              "issued_by_telegram_id",
              "issued_at",
              "expires_at"
            )
            select
              ${inviteId},
              ${code},
              "id",
              ${input.requestId},
              ${input.requestFingerprint},
              ${input.issuedByTelegramId},
              ${input.now},
              ${expiresAt}
            from inserted_workspace
            returning "id"
          `),
      )

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

    const resolveCode = Effect.fn("CoachOnboardingRepo.resolveCode")(function* (
      code: CoachOnboardingInviteCode,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ id: schema.coachOnboardingInvite.id })
            .from(schema.coachOnboardingInvite)
            .where(eq(schema.coachOnboardingInvite.code, code))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "resolveCode", cause }),
      })
      const row = rows[0]
      if (row === undefined) return yield* new InviteCodeUnresolved({ code })
      // Status and expiry are the caller's concern (provisioning `prepare`); a
      // resolvable code always yields its invite id here.
      return CoachOnboardingInviteId.make(row.id)
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
              code: schema.coachOnboardingInvite.code,
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
          code: row.code,
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

    const recordDelivery = Effect.fn("CoachOnboardingRepo.recordDelivery")(function* (
      id: CoachOnboardingInviteId,
      delivery: InviteDeliveryRecord,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.coachOnboardingInvite)
            .set({ delivery })
            .where(eq(schema.coachOnboardingInvite.id, id))
            .returning({ id: schema.coachOnboardingInvite.id }),
        catch: (cause) => new QueryFailed({ operation: "recordDelivery", cause }),
      })
      if (rows.length === 0) {
        return yield* new InviteUnavailable({ id, reason: "not-found" })
      }
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
      const inserted = yield* insertWithFreshCode("reissue.transaction", (code) =>
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
              "code",
              "workspace_id",
              "request_id",
              "request_fingerprint",
              "issued_by_telegram_id",
              "issued_at",
              "expires_at"
            )
            select
              ${inviteId},
              ${code},
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
      )

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
      resolveCode,
      findInvite,
      verifyPending,
      markUsed,
      recordDelivery,
      reissue,
    })
  }),
)

export * as CoachOnboardingRepo from "./coach-onboarding-repo.ts"
