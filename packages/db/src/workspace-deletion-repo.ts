import {
  CoachLanguage,
  WorkspaceDeletionRequestId,
  WorkspaceId,
  WorkspaceNotFound,
} from "@praximo/domain"
import { and, desc, eq, type SQL, sql } from "drizzle-orm"
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
  /**
   * When the current driver's claim lapses; absent when nobody holds one. This
   * is the only honest answer to "is somebody driving this right now" — every
   * other signal on the receipt records what has already landed.
   */
  leaseUntil: Schema.optionalKey(Schema.instanceOf(Date)),
  /**
   * The label the workspace carried, joined live off its row: `""` is a real
   * value — an invite-first workspace the admin never labelled — so absence is
   * reserved for the one thing it can honestly mean, that the cascade has
   * already removed the workspace.
   */
  workspaceName: Schema.optionalKey(Schema.String),
  coachTelegramId: Schema.optionalKey(Schema.NonEmptyString),
  coachLanguage: Schema.optionalKey(CoachLanguage),
})
export interface Operation extends Schema.Schema.Type<typeof Operation> {}

export class RequestConflict extends Schema.TaggedErrorClass<RequestConflict>()(
  "WorkspaceDeletionRepo.RequestConflict",
  {},
) {}

/** Another attempt is driving this operation and its lease has not expired. */
export class LeaseHeld extends Schema.TaggedErrorClass<LeaseHeld>()(
  "WorkspaceDeletionRepo.LeaseHeld",
  {},
) {}

export class InvalidTransition extends Schema.TaggedErrorClass<InvalidTransition>()(
  "WorkspaceDeletionRepo.InvalidTransition",
  {
    operation: Schema.String,
  },
) {}

/**
 * Proof that the holder is the single driver of an operation. Every write to
 * the receipt is fenced on it, so a stage cannot be advanced without one — and
 * an attempt that lost the lease to a later claim can no longer write at all.
 */
export interface Lease {
  readonly requestId: WorkspaceDeletionRequestId
  readonly driverId: string
}

/**
 * The claimed operation, read back *after* the claim landed: stage decisions
 * must be made on post-claim state, never on the snapshot `prepare` returned.
 *
 * `lease` is only meaningful while `operation.state` is `"prepared"`. A
 * completed operation has nothing left to drive, so it is handed back
 * unclaimed rather than reported as contested; the lease then fences nothing
 * and `release` is a no-op.
 */
export interface Claim {
  readonly lease: Lease
  readonly operation: Operation
}

export interface Interface {
  readonly prepare: (
    workspaceId: WorkspaceId,
    requestId: WorkspaceDeletionRequestId,
    now: Date,
  ) => Effect.Effect<
    Operation,
    WorkspaceNotFound | RequestConflict | InvalidTransition | QueryFailed
  >
  readonly claim: (
    requestId: WorkspaceDeletionRequestId,
    now: Date,
  ) => Effect.Effect<Claim, LeaseHeld | InvalidTransition | QueryFailed>
  readonly release: (lease: Lease) => Effect.Effect<void, QueryFailed>
  readonly markPipeline: (
    lease: Lease,
    status: Exclude<PipelineStatus, "pending">,
    now: Date,
  ) => Effect.Effect<Operation, InvalidTransition | QueryFailed>
  readonly markFarewell: (
    lease: Lease,
    status: Exclude<FarewellStatus, "pending">,
    now: Date,
  ) => Effect.Effect<Operation, InvalidTransition | QueryFailed>
  readonly markBotReleased: (
    lease: Lease,
    status: Exclude<BotReleaseStatus, "pending">,
    now: Date,
  ) => Effect.Effect<Operation, InvalidTransition | QueryFailed>
  readonly finalize: (
    lease: Lease,
    now: Date,
  ) => Effect.Effect<Operation, InvalidTransition | QueryFailed>
  /**
   * The workspace's own deletion receipt, prepared or completed. It outlives
   * the workspace by design — the progress surface keeps reading it after the
   * cascade has removed everything else (#110).
   */
  readonly findByWorkspace: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<Operation | undefined, QueryFailed>
  /** Every workspace with a deletion still in flight, for the list's badge. */
  readonly listPrepared: () => Effect.Effect<ReadonlyArray<WorkspaceId>, QueryFailed>
  readonly purgeExpired: (now: Date) => Effect.Effect<number, QueryFailed>
  readonly reconcileOrphans: () => Effect.Effect<number, QueryFailed>
}

/**
 * How long a claim keeps other attempts out. Long enough to cover the whole
 * pipeline (LiveKit cancellation plus two Telegram round trips) and short
 * enough that an attempt killed mid-flight unblocks the coach quickly; every
 * attempt that survives to return also releases its lease immediately.
 */
export const LEASE_DURATION_MS = 60 * 1_000

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/db/WorkspaceDeletionRepo",
) {}

const decodeOperation = Schema.decodeUnknownEffect(Operation)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    // Newest first so a workspace lookup lands on its live receipt: the unique
    // index allows one prepared operation, but completed ones linger for a week.
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
              leaseUntil: schema.workspaceDeletionOperation.leaseUntil,
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
            .orderBy(desc(schema.workspaceDeletionOperation.createdAt))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation, cause }),
      })

    const decodeRow = (row: {
      completedAt: Date | null
      expiresAt: Date | null
      leaseUntil: Date | null
      workspaceName: string | null
      coachTelegramId: string | null
      coachLanguage: string | null
    }) => {
      // Spreading `...rest` first and re-adding only the present values keeps the
      // nullable columns out entirely: the Operation schema marks them optional,
      // so a literal `null` would fail decoding.
      const {
        completedAt,
        expiresAt,
        leaseUntil,
        workspaceName,
        coachTelegramId,
        coachLanguage,
        ...rest
      } = row
      return decodeOperation({
        ...rest,
        ...(completedAt === null ? {} : { completedAt }),
        ...(expiresAt === null ? {} : { expiresAt }),
        ...(leaseUntil === null ? {} : { leaseUntil }),
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
      function* (workspaceId, requestId, now) {
        const replay = yield* load(requestId)
        if (replay !== undefined) {
          if (replay.workspaceId !== workspaceId) return yield* new RequestConflict()
          return replay
        }

        const workspaceRows = yield* Effect.tryPromise({
          try: () =>
            client
              .select({ id: schema.workspace.id })
              .from(schema.workspace)
              .where(eq(schema.workspace.id, workspaceId))
              .limit(1),
          catch: (cause) => new QueryFailed({ operation: "WorkspaceDeletionRepo.prepare", cause }),
        })
        if (workspaceRows[0] === undefined) return yield* new WorkspaceNotFound({ id: workspaceId })

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

    /**
     * Claim the operation for one driver. The conditional UPDATE is the fence:
     * concurrent attempts both issue it, exactly one matches a row, and the
     * loser cannot proceed to any stage — so it cannot repeat a side effect the
     * winner is about to perform.
     */
    const claim: Interface["claim"] = Effect.fn("WorkspaceDeletionRepo.claim")(
      function* (requestId, now) {
        const driverId = crypto.randomUUID()
        const lease: Lease = { requestId, driverId }
        const claimed = yield* Effect.tryPromise({
          try: () =>
            client
              .update(schema.workspaceDeletionOperation)
              .set({
                driverId,
                leaseUntil: new Date(now.getTime() + LEASE_DURATION_MS),
                updatedAt: now,
              })
              .where(
                and(
                  eq(schema.workspaceDeletionOperation.requestId, requestId),
                  eq(schema.workspaceDeletionOperation.state, "prepared"),
                  sql`(
                    ${schema.workspaceDeletionOperation.driverId} is null
                    or ${schema.workspaceDeletionOperation.leaseUntil} is null
                    or ${schema.workspaceDeletionOperation.leaseUntil} <= ${now}
                  )`,
                ),
              )
              .returning({ requestId: schema.workspaceDeletionOperation.requestId }),
          catch: (cause) => new QueryFailed({ operation: "WorkspaceDeletionRepo.claim", cause }),
        })

        const current = yield* load(requestId)
        if (current === undefined) return yield* new InvalidTransition({ operation: "claim" })
        // Nothing matched and the operation is still prepared: a live lease.
        if (claimed.length === 0 && current.state === "prepared") return yield* new LeaseHeld()
        return { lease, operation: current }
      },
    )

    // Only ever clears this driver's own lease, so a release arriving after the
    // lease expired and was re-claimed cannot unlock the new driver's work.
    const release: Interface["release"] = Effect.fn("WorkspaceDeletionRepo.release")(
      function* (lease) {
        yield* Effect.tryPromise({
          try: () =>
            client
              .update(schema.workspaceDeletionOperation)
              .set({ driverId: null, leaseUntil: null })
              .where(
                and(
                  eq(schema.workspaceDeletionOperation.requestId, lease.requestId),
                  eq(schema.workspaceDeletionOperation.driverId, lease.driverId),
                ),
              ),
          catch: (cause) => new QueryFailed({ operation: "WorkspaceDeletionRepo.release", cause }),
        })
      },
    )

    const updateStatus = Effect.fn("WorkspaceDeletionRepo.updateStatus")(function* (
      lease: Lease,
      values: Partial<{
        pipelineStatus: PipelineStatus
        farewellStatus: FarewellStatus
        botReleaseStatus: BotReleaseStatus
      }>,
      now: Date,
      operation: string,
    ) {
      const updated = yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.workspaceDeletionOperation)
            .set({ ...values, updatedAt: now })
            .where(
              and(
                eq(schema.workspaceDeletionOperation.requestId, lease.requestId),
                eq(schema.workspaceDeletionOperation.state, "prepared"),
                eq(schema.workspaceDeletionOperation.driverId, lease.driverId),
              ),
            )
            .returning({ requestId: schema.workspaceDeletionOperation.requestId }),
        catch: (cause) => new QueryFailed({ operation, cause }),
      })
      // A driver whose lease was taken over mid-flight writes nothing and is
      // told so, rather than clobbering the current driver's statuses.
      if (updated.length === 0) return yield* new InvalidTransition({ operation })
      return yield* requireOperation(lease.requestId, operation)
    })

    const markPipeline: Interface["markPipeline"] = Effect.fn("WorkspaceDeletionRepo.markPipeline")(
      (lease, status, now) => updateStatus(lease, { pipelineStatus: status }, now, "markPipeline"),
    )
    const markFarewell: Interface["markFarewell"] = Effect.fn("WorkspaceDeletionRepo.markFarewell")(
      (lease, status, now) => updateStatus(lease, { farewellStatus: status }, now, "markFarewell"),
    )
    const markBotReleased: Interface["markBotReleased"] = Effect.fn(
      "WorkspaceDeletionRepo.markBotReleased",
    )((lease, status, now) =>
      updateStatus(lease, { botReleaseStatus: status }, now, "markBotReleased"),
    )

    const finalize: Interface["finalize"] = Effect.fn("WorkspaceDeletionRepo.finalize")(
      function* (lease, now) {
        const { requestId, driverId } = lease
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
                  and "driver_id" = ${driverId}
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
                select "channel"."snapshot"->>'avatarR2Key'
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

    const findByWorkspace: Interface["findByWorkspace"] = Effect.fn(
      "WorkspaceDeletionRepo.findByWorkspace",
    )(function* (workspaceId) {
      const rows = yield* queryOperations(
        eq(schema.workspaceDeletionOperation.workspaceId, workspaceId),
        "WorkspaceDeletionRepo.findByWorkspace",
      )
      const row = rows[0]
      if (row === undefined) return undefined
      return yield* decodeRow(row)
    })

    const listPrepared: Interface["listPrepared"] = Effect.fn("WorkspaceDeletionRepo.listPrepared")(
      function* () {
        const rows = yield* Effect.tryPromise({
          try: () =>
            client
              .select({ workspaceId: schema.workspaceDeletionOperation.workspaceId })
              .from(schema.workspaceDeletionOperation)
              .where(eq(schema.workspaceDeletionOperation.state, "prepared")),
          catch: (cause) =>
            new QueryFailed({ operation: "WorkspaceDeletionRepo.listPrepared", cause }),
        })
        return rows.map((row) => WorkspaceId.make(row.workspaceId))
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
      claim,
      release,
      markPipeline,
      markFarewell,
      markBotReleased,
      finalize,
      findByWorkspace,
      listPrepared,
      purgeExpired,
      reconcileOrphans,
    })
  }),
)

export * as WorkspaceDeletionRepo from "./workspace-deletion-repo.ts"
