import {
  CoachLanguage,
  WorkspaceDeletionRequestId,
  WorkspaceId,
  WorkspaceNotFound,
} from "@praximo/domain"
import { and, eq, type SQL, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

export const PipelineStatus = Schema.Literals(["pending", "cancelled", "nothing-active"])
export type PipelineStatus = typeof PipelineStatus.Type
export const FarewellStatus = Schema.Literals([
  "pending",
  "sent",
  "not-applicable",
  "undeliverable",
])
export type FarewellStatus = typeof FarewellStatus.Type
export const BotReleaseStatus = Schema.Literals([
  "pending",
  "released",
  "not-connected",
  "already-released",
])
export type BotReleaseStatus = typeof BotReleaseStatus.Type

export const Operation = Schema.Struct({
  requestId: WorkspaceDeletionRequestId,
  workspaceId: WorkspaceId,
  state: Schema.Literals(["prepared", "completed"]),
  pipelineStatus: PipelineStatus,
  farewellStatus: FarewellStatus,
  botReleaseStatus: BotReleaseStatus,
  createdAt: Schema.instanceOf(Date),
  updatedAt: Schema.instanceOf(Date),
  completedAt: Schema.optionalKey(Schema.instanceOf(Date)),
  expiresAt: Schema.optionalKey(Schema.instanceOf(Date)),
  workspaceName: Schema.optionalKey(Schema.NonEmptyString),
  coachTelegramId: Schema.optionalKey(Schema.NonEmptyString),
  coachLanguage: Schema.optionalKey(CoachLanguage),
})
export interface Operation extends Schema.Schema.Type<typeof Operation> {}

export class NameMismatch extends Schema.TaggedErrorClass<NameMismatch>()(
  "WorkspaceDeletionRepo.NameMismatch",
  {},
) {}

export class RequestConflict extends Schema.TaggedErrorClass<RequestConflict>()(
  "WorkspaceDeletionRepo.RequestConflict",
  {},
) {}

export class InvalidTransition extends Schema.TaggedErrorClass<InvalidTransition>()(
  "WorkspaceDeletionRepo.InvalidTransition",
  {
    operation: Schema.String,
  },
) {}

export interface Interface {
  readonly prepare: (
    workspaceId: WorkspaceId,
    requestId: WorkspaceDeletionRequestId,
    confirmationName: string,
    now: Date,
  ) => Effect.Effect<
    Operation,
    WorkspaceNotFound | NameMismatch | RequestConflict | InvalidTransition | QueryFailed
  >
  readonly markPipeline: (
    requestId: WorkspaceDeletionRequestId,
    status: Exclude<PipelineStatus, "pending">,
    now: Date,
  ) => Effect.Effect<Operation, InvalidTransition | QueryFailed>
  readonly markFarewell: (
    requestId: WorkspaceDeletionRequestId,
    status: Exclude<FarewellStatus, "pending">,
    now: Date,
  ) => Effect.Effect<Operation, InvalidTransition | QueryFailed>
  readonly markBotReleased: (
    requestId: WorkspaceDeletionRequestId,
    status: Exclude<BotReleaseStatus, "pending">,
    now: Date,
  ) => Effect.Effect<Operation, InvalidTransition | QueryFailed>
  readonly finalize: (
    requestId: WorkspaceDeletionRequestId,
    now: Date,
  ) => Effect.Effect<Operation, InvalidTransition | QueryFailed>
  readonly isDeleting: (workspaceId: WorkspaceId) => Effect.Effect<boolean, QueryFailed>
  readonly purgeExpired: (now: Date) => Effect.Effect<number, QueryFailed>
  readonly reconcileOrphans: () => Effect.Effect<number, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/db/WorkspaceDeletionRepo",
) {}

const decodeOperation = Schema.decodeUnknownEffect(Operation)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    const queryOperations = (where: SQL | undefined, operation: string) =>
      Effect.tryPromise({
        try: () =>
          client
            .select({
              requestId: schema.workspaceDeletionOperation.requestId,
              workspaceId: schema.workspaceDeletionOperation.workspaceId,
              state: schema.workspaceDeletionOperation.state,
              pipelineStatus: schema.workspaceDeletionOperation.pipelineStatus,
              farewellStatus: schema.workspaceDeletionOperation.farewellStatus,
              botReleaseStatus: schema.workspaceDeletionOperation.botReleaseStatus,
              createdAt: schema.workspaceDeletionOperation.createdAt,
              updatedAt: schema.workspaceDeletionOperation.updatedAt,
              completedAt: schema.workspaceDeletionOperation.completedAt,
              expiresAt: schema.workspaceDeletionOperation.expiresAt,
              workspaceName: schema.workspace.name,
              coachTelegramId: schema.member.telegramUserId,
              coachLanguage: schema.member.language,
            })
            .from(schema.workspaceDeletionOperation)
            .leftJoin(
              schema.workspace,
              eq(schema.workspace.id, schema.workspaceDeletionOperation.workspaceId),
            )
            .leftJoin(
              schema.member,
              and(
                eq(schema.member.workspaceId, schema.workspaceDeletionOperation.workspaceId),
                eq(schema.member.role, "owner"),
              ),
            )
            .where(where)
            .limit(1),
        catch: (cause) => new QueryFailed({ operation, cause }),
      })

    const decodeRow = (row: {
      completedAt: Date | null
      expiresAt: Date | null
      workspaceName: string | null
      coachTelegramId: string | null
      coachLanguage: string | null
    }) => {
      // Spreading `...rest` first and re-adding only the present values keeps the
      // nullable columns out entirely: the Operation schema marks them optional,
      // so a literal `null` would fail decoding.
      const { completedAt, expiresAt, workspaceName, coachTelegramId, coachLanguage, ...rest } = row
      return decodeOperation({
        ...rest,
        ...(completedAt === null ? {} : { completedAt }),
        ...(expiresAt === null ? {} : { expiresAt }),
        ...(workspaceName === null ? {} : { workspaceName }),
        ...(coachTelegramId === null ? {} : { coachTelegramId }),
        ...(coachLanguage === null ? {} : { coachLanguage }),
      }).pipe(
        Effect.mapError(
          (cause) => new QueryFailed({ operation: "WorkspaceDeletionRepo.load.decode", cause }),
        ),
      )
    }

    const load = Effect.fn("WorkspaceDeletionRepo.load")(function* (
      requestId: WorkspaceDeletionRequestId,
    ) {
      const rows = yield* queryOperations(
        eq(schema.workspaceDeletionOperation.requestId, requestId),
        "WorkspaceDeletionRepo.load",
      )
      const row = rows[0]
      if (row === undefined) return undefined
      return yield* decodeRow(row)
    })

    // Adopt an in-flight deletion by workspace: the client mints a fresh
    // requestId on every dialog mount, so a resumed attempt cannot replay by
    // requestId. The one-prepared-per-workspace index guarantees at most one row.
    const loadPreparedByWorkspace = Effect.fn("WorkspaceDeletionRepo.loadPreparedByWorkspace")(
      function* (workspaceId: WorkspaceId) {
        const rows = yield* queryOperations(
          and(
            eq(schema.workspaceDeletionOperation.workspaceId, workspaceId),
            eq(schema.workspaceDeletionOperation.state, "prepared"),
          ),
          "WorkspaceDeletionRepo.loadPreparedByWorkspace",
        )
        const row = rows[0]
        if (row === undefined) return undefined
        return yield* decodeRow(row)
      },
    )

    const requireOperation = Effect.fn("WorkspaceDeletionRepo.requireOperation")(function* (
      requestId: WorkspaceDeletionRequestId,
      operation: string,
    ) {
      const current = yield* load(requestId)
      if (current === undefined) return yield* new InvalidTransition({ operation })
      return current
    })

    const prepare: Interface["prepare"] = Effect.fn("WorkspaceDeletionRepo.prepare")(
      function* (workspaceId, requestId, confirmationName, now) {
        const replay = yield* load(requestId)
        if (replay !== undefined) {
          if (replay.workspaceId !== workspaceId) return yield* new RequestConflict()
          return replay
        }

        const workspaceRows = yield* Effect.tryPromise({
          try: () =>
            client
              .select({ name: schema.workspace.name })
              .from(schema.workspace)
              .where(eq(schema.workspace.id, workspaceId))
              .limit(1),
          catch: (cause) => new QueryFailed({ operation: "WorkspaceDeletionRepo.prepare", cause }),
        })
        const workspace = workspaceRows[0]
        if (workspace === undefined) return yield* new WorkspaceNotFound({ id: workspaceId })
        if (workspace.name !== confirmationName) return yield* new NameMismatch()

        yield* Effect.tryPromise({
          try: () =>
            client
              .insert(schema.workspaceDeletionOperation)
              .values({ requestId, workspaceId, createdAt: now, updatedAt: now })
              .onConflictDoNothing(),
          catch: (cause) =>
            new QueryFailed({ operation: "WorkspaceDeletionRepo.prepare.insert", cause }),
        })
        const prepared = yield* load(requestId)
        if (prepared === undefined) {
          // The insert was a no-op: an earlier attempt already holds the
          // one-prepared-per-workspace fence under a different requestId. Adopt
          // that operation and return it so the caller resumes it to completion
          // instead of being permanently blocked ("already in progress").
          const adopted = yield* loadPreparedByWorkspace(workspaceId)
          if (adopted === undefined) return yield* new InvalidTransition({ operation: "prepare" })
          return adopted
        }
        if (prepared.workspaceId !== workspaceId) return yield* new RequestConflict()
        return prepared
      },
    )

    const updateStatus = Effect.fn("WorkspaceDeletionRepo.updateStatus")(function* (
      requestId: WorkspaceDeletionRequestId,
      values: Partial<{
        pipelineStatus: PipelineStatus
        farewellStatus: FarewellStatus
        botReleaseStatus: BotReleaseStatus
      }>,
      now: Date,
      operation: string,
    ) {
      yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.workspaceDeletionOperation)
            .set({ ...values, updatedAt: now })
            .where(
              and(
                eq(schema.workspaceDeletionOperation.requestId, requestId),
                eq(schema.workspaceDeletionOperation.state, "prepared"),
              ),
            ),
        catch: (cause) => new QueryFailed({ operation, cause }),
      })
      return yield* requireOperation(requestId, operation)
    })

    const markPipeline: Interface["markPipeline"] = Effect.fn("WorkspaceDeletionRepo.markPipeline")(
      (requestId, status, now) =>
        updateStatus(requestId, { pipelineStatus: status }, now, "markPipeline"),
    )
    const markFarewell: Interface["markFarewell"] = Effect.fn("WorkspaceDeletionRepo.markFarewell")(
      (requestId, status, now) =>
        updateStatus(requestId, { farewellStatus: status }, now, "markFarewell"),
    )
    const markBotReleased: Interface["markBotReleased"] = Effect.fn(
      "WorkspaceDeletionRepo.markBotReleased",
    )((requestId, status, now) =>
      updateStatus(requestId, { botReleaseStatus: status }, now, "markBotReleased"),
    )

    const finalize: Interface["finalize"] = Effect.fn("WorkspaceDeletionRepo.finalize")(
      function* (requestId, now) {
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000)
        const result = yield* Effect.tryPromise({
          try: () =>
            client.execute(sql`
              with ready as (
                select "workspace_id"
                from "workspace_deletion_operation"
                where
                  "request_id" = ${requestId}
                  and "state" = 'prepared'
                  and "pipeline_status" <> 'pending'
                  and "farewell_status" <> 'pending'
                  and "bot_release_status" <> 'pending'
              ),
              owned_keys as (
                select "avatar_r2_key" as "object_key"
                from "workspace"
                where "id" in (select "workspace_id" from ready)
                union
                select "avatar_r2_key"
                from "member"
                where "workspace_id" in (select "workspace_id" from ready)
                union
                select "avatar_r2_key"
                from "client"
                where "workspace_id" in (select "workspace_id" from ready)
                union
                select "channel"."telegram_snapshot"->>'avatarR2Key'
                from "channel"
                join "client" on "client"."id" = "channel"."client_id"
                where "client"."workspace_id" in (select "workspace_id" from ready)
                union
                select "segment"->>'r2Key'
                from "track"
                join "recording" on "recording"."id" = "track"."recording_id"
                join "session" on "session"."id" = "recording"."session_id"
                cross join lateral jsonb_array_elements("track"."segments") as "segment"
                where "session"."workspace_id" in (select "workspace_id" from ready)
                union
                select "track_transcript"."r2_key"
                from "track_transcript"
                join "track" on "track"."id" = "track_transcript"."track_id"
                join "recording" on "recording"."id" = "track"."recording_id"
                join "session" on "session"."id" = "recording"."session_id"
                where "session"."workspace_id" in (select "workspace_id" from ready)
                union
                select "transcript"."r2_key"
                from "transcript"
                join "session" on "session"."id" = "transcript"."session_id"
                where "session"."workspace_id" in (select "workspace_id" from ready)
                union
                select "artifact"."r2_key"
                from "artifact"
                join "session" on "session"."id" = "artifact"."session_id"
                where "session"."workspace_id" in (select "workspace_id" from ready)
              ),
              inserted_jobs as (
                insert into "object_cleanup_job" (
                  "id",
                  "object_key",
                  "reason",
                  "correlation_id",
                  "available_at"
                )
                select
                  'cleanup_' || md5("object_key"),
                  "object_key",
                  'workspace-deletion',
                  ${requestId},
                  ${now}
                from owned_keys
                where "object_key" is not null and "object_key" <> ''
                on conflict ("object_key") do nothing
                returning "id"
              ),
              deleted_workspace as (
                delete from "workspace"
                where "id" in (select "workspace_id" from ready)
                returning "id"
              )
              update "workspace_deletion_operation"
              set
                "state" = 'completed',
                "completed_at" = ${now},
                "expires_at" = ${expiresAt},
                "updated_at" = ${now}
              where
                "request_id" = ${requestId}
                and (
                  "state" = 'completed'
                  or exists (select 1 from deleted_workspace)
                )
              returning "request_id"
            `),
          catch: (cause) => new QueryFailed({ operation: "WorkspaceDeletionRepo.finalize", cause }),
        })
        if (result.rows.length === 0) return yield* new InvalidTransition({ operation: "finalize" })
        return yield* requireOperation(requestId, "finalize")
      },
    )

    const isDeleting: Interface["isDeleting"] = Effect.fn("WorkspaceDeletionRepo.isDeleting")(
      function* (workspaceId) {
        const rows = yield* Effect.tryPromise({
          try: () =>
            client
              .select({ requestId: schema.workspaceDeletionOperation.requestId })
              .from(schema.workspaceDeletionOperation)
              .where(
                and(
                  eq(schema.workspaceDeletionOperation.workspaceId, workspaceId),
                  eq(schema.workspaceDeletionOperation.state, "prepared"),
                ),
              )
              .limit(1),
          catch: (cause) =>
            new QueryFailed({ operation: "WorkspaceDeletionRepo.isDeleting", cause }),
        })
        return rows.length > 0
      },
    )

    const purgeExpired: Interface["purgeExpired"] = Effect.fn("WorkspaceDeletionRepo.purgeExpired")(
      function* (now) {
        const result = yield* Effect.tryPromise({
          try: () =>
            client.execute(sql`
            delete from "workspace_deletion_operation"
            where "state" = 'completed' and "expires_at" <= ${now}
            returning "request_id"
          `),
          catch: (cause) =>
            new QueryFailed({ operation: "WorkspaceDeletionRepo.purgeExpired", cause }),
        })
        return result.rows.length
      },
    )

    // A prepared operation whose workspace is already gone can never finalize
    // (its cascade deletes nothing) and would otherwise linger indefinitely.
    // finalize deletes the workspace and completes the receipt atomically, so a
    // still-prepared row with a missing workspace is always a true orphan.
    const reconcileOrphans: Interface["reconcileOrphans"] = Effect.fn(
      "WorkspaceDeletionRepo.reconcileOrphans",
    )(function* () {
      const result = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            delete from "workspace_deletion_operation" as "op"
            where
              "op"."state" = 'prepared'
              and not exists (
                select 1 from "workspace"
                where "workspace"."id" = "op"."workspace_id"
              )
            returning "op"."request_id"
          `),
        catch: (cause) =>
          new QueryFailed({ operation: "WorkspaceDeletionRepo.reconcileOrphans", cause }),
      })
      return result.rows.length
    })

    return Service.of({
      prepare,
      markPipeline,
      markFarewell,
      markBotReleased,
      finalize,
      isDeleting,
      purgeExpired,
      reconcileOrphans,
    })
  }),
)

export * as WorkspaceDeletionRepo from "./workspace-deletion-repo.ts"
