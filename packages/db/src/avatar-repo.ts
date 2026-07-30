import { WorkspaceId } from "@praximo/domain"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

/**
 * The stored avatar keys, and the only writer any of them has (#225, #231).
 *
 * Separate from the repositories that happen to read the same rows —
 * `CoachBotProvisioningRepo` owns how a bot becomes installed, `MemberRepo` owns
 * what an authenticated coach launch may change about itself, `ClientRepo` owns
 * the coach's roster — because **an avatar column needs exactly one writer and
 * the reason is the same one `member.language` has** (#130): the column is
 * written from more than one *occasion* (provisioning, the daily sweep, invite
 * acceptance, and the Google import in #59) and a second owner is how a column
 * ends up with two half-right statements.
 *
 * What that one writer has to do is more than an assignment. A key it replaces
 * names an object nothing will ever reference again, so the same statement hands
 * it to `object_cleanup_job` — and a key it is about to *install* must come back
 * out of that queue, or somebody who flips between two photos inside the cleanup
 * window ends up with a row naming an object the sweeper has deleted. That
 * discipline is written once, in {@link avatarWrite}, and the two columns differ
 * only in which row they hang off.
 */

/**
 * Where the coach's photo is read from, and in which order.
 *
 * `workspace.avatar_r2_key` is a *practice* photo — uploaded from a settings
 * screen that does not exist yet — and it overrides the coach's own once it has a
 * writer (#225). The order lives here, as one expression, because two surfaces
 * ask the question: the Acceptance Page's serving route and the invitation lookup
 * that tells the page whether to ask at all. Two `coalesce`s are how the practice
 * photo would come to override on one screen and not the other.
 *
 * Takes its aliases the way {@link isoColumn} takes its column — as text, so a
 * statement that already named its joins keeps its own names.
 */
export const coachAvatarKeyColumn = (workspace: string, member: string) =>
  sql.raw(`coalesce(${workspace}."avatar_r2_key", ${member}."avatar_r2_key")`)

export interface CoachAvatarWrite {
  readonly workspaceId: WorkspaceId
  /** The key to install. Absent clears the column — the coach withdrew the photo. */
  readonly r2Key?: string
  readonly now: Date
}

export interface ClientAvatarWrite {
  readonly workspaceId: WorkspaceId
  readonly clientId: string
  /** The key to install. Absent clears the column. */
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
  /**
   * No row here owns that column — a workspace with no owner member, or a client
   * id that does not belong to the workspace that asked. Never a shape a caller
   * can fix by retrying.
   */
  | "no-row"
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
   *
   * The **member column alone**, deliberately, where
   * {@link coachAvatarKeyForInvite} coalesces: this answers "is this the photo we
   * imported?", and a practice photo overriding it on screen changes nothing
   * about whether Telegram's current one still has to be fetched.
   */
  readonly coachAvatarKey: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<string | undefined, QueryFailed>
  readonly setCoachAvatar: (input: CoachAvatarWrite) => Effect.Effect<AvatarChange, QueryFailed>
  /**
   * One client's avatar key, **scoped by workspace** (#231).
   *
   * The scope is the authorisation. This read backs a route in the coach Mini App
   * that serves the bytes, so "a coach cannot read an avatar belonging to another
   * workspace" is a property of the statement rather than of a check somebody
   * upstream remembered to write.
   */
  readonly clientAvatarKey: (
    workspaceId: WorkspaceId,
    clientId: string,
  ) => Effect.Effect<string | undefined, QueryFailed>
  readonly setClientAvatar: (input: ClientAvatarWrite) => Effect.Effect<AvatarChange, QueryFailed>
  /**
   * The photo to show for the coach who issued this invitation (#231).
   *
   * Keyed by the token because the surface is: the Acceptance Page holds one, has
   * no session, and nothing to authorise against but that. It discloses no more
   * than the page already does — which names the coach in its first sentence.
   */
  readonly coachAvatarKeyForInvite: (
    token: string,
  ) => Effect.Effect<string | undefined, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/db/AvatarRepo") {}

/** Why a key is in the cleanup queue, beside `workspace-deletion`'s own reason. */
const SupersededReason = "avatar-superseded"

/**
 * A `count(*)` as the statement's answer carries it — the driver may hand one over
 * as a string, and every branch that reads one wants a number.
 */
const count = (value: string | number | undefined): number => Number(value ?? 0)

/** The row the composed statement below always answers with. */
interface AvatarWriteRow {
  readonly targets: string | number
  readonly leases: string | number
  readonly writes: string | number
  readonly superseded: string | null
}

/**
 * Installing one avatar key, whichever column it lives on.
 *
 * Composed rather than written twice because the interesting arms — the live
 * lease, the unqueue, the supersede — are identical for a coach and for a client,
 * and they are the arms where a second half-right copy either leaks objects or
 * deletes live ones. What a caller supplies is the row that owns the column
 * (`target`, already scoped and locked), the table that row is in, what to
 * correlate the cleanup job with, and any further write that must happen only if
 * this one did (`alsoWritten`).
 */
const avatarWrite = (input: {
  readonly target: ReturnType<typeof sql>
  readonly table: ReturnType<typeof sql>
  readonly correlationId: string
  readonly nextKey: ReturnType<typeof sql>
  readonly now: Date
  readonly alsoWritten?: ReturnType<typeof sql>
}) => {
  const { table, nextKey, now } = input
  const alsoWritten = input.alsoWritten === undefined ? sql`` : sql`, ${input.alsoWritten}`
  return sql`
    with "target" as (${input.target}),
    -- The key this statement wants to install, already claimed by the cleanup
    -- worker under a live lease. It is going to delete that object whatever
    -- happens here, so the column must not be pointed at it — deleting the job
    -- row would not call the deletion off, it would only lose the record of it.
    -- An expired lease is not a claim: claimBatch re-takes those, so such a job is
    -- ordinary queue content again.
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
      update ${table}
      set "avatar_r2_key" = ${nextKey}, "updated_at" = ${now}
      from "target"
      where
        ${table}."id" = "target"."id"
        and "target"."avatar_r2_key" is distinct from ${nextKey}
        and not exists (select 1 from "leased")
      returning "target"."avatar_r2_key" as "superseded"
    ),
    -- Ahead of the insert below, and unconditional apart from that lease:
    -- whatever else this statement does, the key the row ends up naming may not be
    -- sitting in the deletion queue. A subject who flips A -> B -> A inside the
    -- cleanup window would otherwise have A's queued job delete the object A now
    -- points at.
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
        ${input.correlationId},
        ${now}
      from "written"
      where "superseded" is not null and "superseded" <> ''
      on conflict ("object_key") do nothing
    )${alsoWritten}
    select
      (select count(*) from "target") as "targets",
      (select count(*) from "leased") as "leases",
      (select count(*) from "written") as "writes",
      (select "superseded" from "written") as "superseded"
  `
}

/** The statement's four counters, read back as one of the four outcomes. */
const avatarChange = (row: AvatarWriteRow | undefined): AvatarChange => {
  if (row === undefined || count(row.targets) === 0) {
    return { outcome: "no-row" } satisfies AvatarChange
  }
  if (count(row.leases) > 0) return { outcome: "deferred" } satisfies AvatarChange
  if (count(row.writes) === 0) return { outcome: "unchanged" } satisfies AvatarChange
  return {
    outcome: "written",
    ...(row.superseded === null || row.superseded === "" ? {} : { superseded: row.superseded }),
  } satisfies AvatarChange
}

/**
 * The key a statement is about to install, cast so every arm above — the `is
 * distinct from`, the unqueue's guard — has a text-typed parameter to compare
 * against rather than an untyped `null` Postgres cannot infer.
 */
const keyParameter = (r2Key: string | undefined) => sql`${r2Key ?? null}::text`

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
      const result = yield* Effect.tryPromise({
        try: () =>
          client.execute(
            avatarWrite({
              target: sql`
                select "id", "avatar_r2_key"
                from "member"
                where "workspace_id" = ${input.workspaceId} and "role" = 'owner'
                limit 1
                for update
              `,
              table: sql`"member"`,
              correlationId: input.workspaceId,
              nextKey: keyParameter(input.r2Key),
              now: input.now,
            }),
          ),
        catch: (cause) => new QueryFailed({ operation: "AvatarRepo.setCoachAvatar", cause }),
      })
      return avatarChange(result.rows[0] as AvatarWriteRow | undefined)
    })

    const clientAvatarKey = Effect.fn("AvatarRepo.clientAvatarKey")(function* (
      workspaceId: WorkspaceId,
      clientId: string,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ avatarR2Key: schema.client.avatarR2Key })
            .from(schema.client)
            .where(and(eq(schema.client.id, clientId), eq(schema.client.workspaceId, workspaceId)))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "AvatarRepo.clientAvatarKey", cause }),
      })
      return rows[0]?.avatarR2Key ?? undefined
    })

    /**
     * The client's key, and the same key inside their primary channel's snapshot,
     * in one statement.
     *
     * Both are written because both are read by something: `client.avatar_r2_key`
     * is the client's avatar whichever door they came through, and
     * `channel.snapshot` is the record of the identity that walked in — the shape
     * the schema has declared since #57 (`{ name, username, avatarR2Key }`) and the
     * shape workspace deletion already collects. Writing them in one statement is
     * what makes "the same key" true by construction rather than by two callers
     * agreeing.
     */
    const setClientAvatar = Effect.fn("AvatarRepo.setClientAvatar")(function* (
      input: ClientAvatarWrite,
    ) {
      const nextKey = keyParameter(input.r2Key)
      const result = yield* Effect.tryPromise({
        try: () =>
          client.execute(
            avatarWrite({
              // Scoped by workspace as well as by id: this is reachable from the
              // bot, where the only thing that says which workspace a `/start`
              // belongs to is the invitation it resolved.
              target: sql`
                select "id", "avatar_r2_key"
                from "client"
                where "id" = ${input.clientId} and "workspace_id" = ${input.workspaceId}
                limit 1
                for update
              `,
              table: sql`"client"`,
              correlationId: input.workspaceId,
              nextKey,
              now: input.now,
              alsoWritten: sql`
                "snapshot_written" as (
                  update "channel"
                  set
                    "snapshot" = case
                      when ${nextKey} is null
                        then coalesce("snapshot", '{}'::jsonb) - 'avatarR2Key'
                      else
                        jsonb_set(
                          coalesce("snapshot", '{}'::jsonb),
                          '{avatarR2Key}',
                          to_jsonb(${nextKey})
                        )
                    end,
                    "updated_at" = ${input.now}
                  from "written"
                  where "channel"."client_id" = ${input.clientId} and "channel"."is_primary"
                )
              `,
            }),
          ),
        catch: (cause) => new QueryFailed({ operation: "AvatarRepo.setClientAvatar", cause }),
      })
      return avatarChange(result.rows[0] as AvatarWriteRow | undefined)
    })

    const coachAvatarKeyForInvite = Effect.fn("AvatarRepo.coachAvatarKeyForInvite")(function* (
      token: string,
    ) {
      const result = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            select ${coachAvatarKeyColumn('"w"', '"m"')} as "avatar_r2_key"
            from "invite" as "i"
            join "workspace" as "w" on "w"."id" = "i"."workspace_id"
            left join "member" as "m"
              on "m"."workspace_id" = "i"."workspace_id" and "m"."role" = 'owner'
            where "i"."token" = ${token}
            limit 1
          `),
        catch: (cause) =>
          new QueryFailed({ operation: "AvatarRepo.coachAvatarKeyForInvite", cause }),
      })
      const row = result.rows[0] as { avatar_r2_key: string | null } | undefined
      return row?.avatar_r2_key ?? undefined
    })

    return Service.of({
      coachAvatarKey,
      setCoachAvatar,
      clientAvatarKey,
      setClientAvatar,
      coachAvatarKeyForInvite,
    })
  }),
)

export * as AvatarRepo from "./avatar-repo.ts"
