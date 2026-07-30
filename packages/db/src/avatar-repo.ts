import { WorkspaceId } from "@praximo/domain"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

/**
 * The stored avatar keys, and the only writer any of them has (#225).
 *
 * Separate from the repositories that happen to read the same rows —
 * `CoachBotProvisioningRepo` owns how a bot becomes installed, `MemberRepo` owns
 * what an authenticated coach launch may change about itself — because
 * **`member.avatar_r2_key` needs exactly one writer and the reason is the same
 * one `member.language` has** (#130): the column is written from more than one
 * *occasion* (provisioning, the daily sweep, and the Google import in #59) and a
 * second owner is how a column ends up with two half-right statements.
 *
 * What that one writer has to do is more than an assignment. A key it replaces
 * names an object nothing will ever reference again, so the same statement hands
 * it to `object_cleanup_job` — and a key it is about to *install* must come back
 * out of that queue, or a coach who flips between two photos inside the cleanup
 * window ends up with a row naming an object the sweeper has deleted.
 */

export interface CoachAvatarWrite {
  readonly workspaceId: WorkspaceId
  /** The key to install. Absent clears the column — the coach withdrew the photo. */
  readonly r2Key?: string
  readonly now: Date
}

/**
 * What the write settled into. Four cases rather than a boolean, because three of
 * them mean something different to the caller and the statement is the only thing
 * that can tell them apart.
 */
export type AvatarWriteOutcome =
  /** The column moved. */
  | "written"
  /** The column already named this key; nothing was done and nothing is owed. */
  | "unchanged"
  /** No owner member to write to — a workspace shape activation does not produce. */
  | "no-owner"
  /**
   * The key is being deleted from R2 right now, so it may not be installed: the
   * cleanup worker holds a live lease on it and will remove the object whatever
   * this statement writes. Nothing was changed; the caller retries later, by which
   * time the job is gone and the key is free again.
   */
  | "deferred"

export interface AvatarChange {
  readonly outcome: AvatarWriteOutcome
  /**
   * The key this write replaced, already queued for deletion. Absent when
   * nothing was replaced.
   */
  readonly superseded?: string
}

export interface Interface {
  /**
   * The coach's current avatar key — what a refresh compares its candidate
   * against before it spends a download (#225).
   */
  readonly coachAvatarKey: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<string | undefined, QueryFailed>
  readonly setCoachAvatar: (input: CoachAvatarWrite) => Effect.Effect<AvatarChange, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/db/AvatarRepo") {}

/** Why a key is in the cleanup queue, beside `workspace-deletion`'s own reason. */
const SupersededReason = "avatar-superseded"

/**
 * A `count(*)` as the statement's answer carries it — the driver may hand one over
 * as a string, and every branch that reads one wants a number.
 */
const count = (value: string | number | undefined): number => Number(value ?? 0)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    const coachAvatarKey = Effect.fn("AvatarRepo.coachAvatarKey")(function* (
      workspaceId: WorkspaceId,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ avatarR2Key: schema.member.avatarR2Key })
            .from(schema.member)
            .where(and(eq(schema.member.workspaceId, workspaceId), eq(schema.member.role, "owner")))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "AvatarRepo.coachAvatarKey", cause }),
      })
      return rows[0]?.avatarR2Key ?? undefined
    })

    const setCoachAvatar = Effect.fn("AvatarRepo.setCoachAvatar")(function* (
      input: CoachAvatarWrite,
    ) {
      const { workspaceId, now } = input
      // Cast so every arm below — the `is distinct from`, the unqueue's guard —
      // has a text-typed parameter to compare against rather than an untyped
      // `null` Postgres cannot infer.
      const nextKey = sql`${input.r2Key ?? null}::text`
      const result = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            with "owner" as (
              select "id", "avatar_r2_key"
              from "member"
              where "workspace_id" = ${workspaceId} and "role" = 'owner'
              limit 1
              for update
            ),
            -- The key this statement wants to install, already claimed by the
            -- cleanup worker under a live lease. It is going to delete that object
            -- whatever happens here, so the column must not be pointed at it —
            -- deleting the job row would not call the deletion off, it would only
            -- lose the record of it. An expired lease is not a claim -- claimBatch
            -- re-takes those, so such a job is ordinary queue content again.
            "leased" as (
              select 1
              from "object_cleanup_job"
              where
                ${nextKey} is not null
                and "object_key" = ${nextKey}
                and "status" = 'leased'
                and "lease_until" > ${now}
            ),
            "written" as (
              update "member"
              set "avatar_r2_key" = ${nextKey}, "updated_at" = ${now}
              from "owner"
              where
                "member"."id" = "owner"."id"
                and "owner"."avatar_r2_key" is distinct from ${nextKey}
                and not exists (select 1 from "leased")
              returning "owner"."avatar_r2_key" as "superseded"
            ),
            -- Ahead of the insert below, and unconditional apart from that lease:
            -- whatever else this statement does, the key the row ends up naming may
            -- not be sitting in the deletion queue. A coach who flips A -> B -> A
            -- inside the cleanup window would otherwise have A's queued job delete
            -- the object A now points at.
            "unqueued" as (
              delete from "object_cleanup_job"
              where
                ${nextKey} is not null
                and "object_key" = ${nextKey}
                and not exists (select 1 from "leased")
            ),
            "queued" as (
              insert into "object_cleanup_job" (
                "id", "object_key", "reason", "correlation_id", "available_at"
              )
              select
                'cleanup_' || md5("superseded"),
                "superseded",
                ${SupersededReason},
                ${workspaceId},
                ${now}
              from "written"
              where "superseded" is not null and "superseded" <> ''
              on conflict ("object_key") do nothing
            )
            select
              (select count(*) from "owner") as "owners",
              (select count(*) from "leased") as "leases",
              (select count(*) from "written") as "writes",
              (select "superseded" from "written") as "superseded"
          `),
        catch: (cause) => new QueryFailed({ operation: "AvatarRepo.setCoachAvatar", cause }),
      })
      const row = result.rows[0] as
        | {
            owners: string | number
            leases: string | number
            writes: string | number
            superseded: string | null
          }
        | undefined
      if (row === undefined || count(row.owners) === 0) {
        return { outcome: "no-owner" } satisfies AvatarChange
      }
      if (count(row.leases) > 0) return { outcome: "deferred" } satisfies AvatarChange
      if (count(row.writes) === 0) return { outcome: "unchanged" } satisfies AvatarChange
      return {
        outcome: "written",
        ...(row.superseded === null || row.superseded === "" ? {} : { superseded: row.superseded }),
      } satisfies AvatarChange
    })

    return Service.of({ coachAvatarKey, setCoachAvatar })
  }),
)

export * as AvatarRepo from "./avatar-repo.ts"
