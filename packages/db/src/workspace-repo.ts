import {
  CoachLanguage,
  CoachOnboardingInviteCancellationReason,
  CoachOnboardingInviteCode,
  CoachOnboardingInviteId,
  CoachOnboardingInviteStatus,
  InviteDeliveryRecord,
  TelegramId,
  Workspace,
  WorkspaceId,
  WorkspaceNotFound,
} from "@praximo/domain"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database, decodeFirstRow, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

export const BotConnectionStatus = Schema.Literals(["awaiting-setup", "connected", "needs-relink"])
export type BotConnectionStatus = typeof BotConnectionStatus.Type

/**
 * The onboarding state the coaches list renders from (#107): the invite's own
 * lifecycle plus the two facts that outlive it — the connected bot and the
 * coach's terms acceptance. Everything the list shows is derived from these, so
 * the surface never issues a follow-up query per row.
 */
export const ListInvite = Schema.Struct({
  id: CoachOnboardingInviteId,
  code: CoachOnboardingInviteCode,
  status: CoachOnboardingInviteStatus,
  issuedAt: Schema.instanceOf(Date),
  expiresAt: Schema.instanceOf(Date),
  acceptedAt: Schema.optionalKey(Schema.instanceOf(Date)),
  acceptedByTelegramId: Schema.optionalKey(Schema.NonEmptyString),
  cancelledAt: Schema.optionalKey(Schema.instanceOf(Date)),
  cancellationReason: Schema.optionalKey(CoachOnboardingInviteCancellationReason),
  delivery: Schema.optionalKey(InviteDeliveryRecord),
})
export interface ListInvite extends Schema.Schema.Type<typeof ListInvite> {}

export const ListItem = Schema.Struct({
  id: WorkspaceId,
  // "" is a real value: an invite-first workspace not yet labeled or claimed.
  name: Schema.String,
  botStatus: BotConnectionStatus,
  botUsername: Schema.optionalKey(Schema.NonEmptyString),
  /** Bound only once the coach's bot connects — not at invite acceptance. */
  ownerTelegramUserId: Schema.optionalKey(Schema.NonEmptyString),
  termsAcceptedAt: Schema.optionalKey(Schema.instanceOf(Date)),
  lastActivityAt: Schema.optionalKey(Schema.instanceOf(Date)),
  invite: Schema.optionalKey(ListInvite),
})
export interface ListItem extends Schema.Schema.Type<typeof ListItem> {}

/**
 * The details screen reads the same aggregate the list does, plus the two facts
 * only the details screen shows: when the coach joined and when they last
 * logged in. Bot branding (description, avatar) is deliberately absent — it is
 * the coach's property and no admin surface reads or writes it (#108).
 */
export const Detail = Schema.Struct({
  id: WorkspaceId,
  name: Schema.String,
  createdAt: Schema.instanceOf(Date),
  updatedAt: Schema.instanceOf(Date),
  coachLanguage: Schema.optionalKey(CoachLanguage),
  ownerTelegramUserId: Schema.optionalKey(Schema.String),
  /** Onboarding completion: terms acceptance, or the owner member's creation. */
  joinedAt: Schema.optionalKey(Schema.instanceOf(Date)),
  termsAcceptedAt: Schema.optionalKey(Schema.instanceOf(Date)),
  lastLoginAt: Schema.optionalKey(Schema.instanceOf(Date)),
  lastActivityAt: Schema.optionalKey(Schema.instanceOf(Date)),
  botStatus: BotConnectionStatus,
  botUsername: Schema.optionalKey(Schema.NonEmptyString),
  invite: Schema.optionalKey(ListInvite),
})
export interface Detail extends Schema.Schema.Type<typeof Detail> {}

export interface RenameInput {
  readonly id: WorkspaceId
  readonly expectedUpdatedAt: Date
  readonly name: string
  readonly now: Date
}

/**
 * Where one Telegram identity stands as a coach — the coach half of the manager
 * Mini App's entry role (#106). Three states, most advanced first:
 *
 * - `active` — onboarding is finished: the bot is connected and terms accepted.
 * - `bot-connected` — provisioning landed, first login + ToS is still pending.
 * - `accepted` — the invite is exclusively claimed but no bot exists yet, so
 *   the claim is the only thing tying the identity to a workspace. Its `code`
 *   travels with it: the original deep link is what resumes the claim (#112).
 *
 * Absent means the identity is not a coach at all — an unknown viewer, or an
 * admin who never claimed an invite.
 */
export const CoachContext = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("accepted"),
    workspaceId: WorkspaceId,
    code: CoachOnboardingInviteCode,
  }),
  Schema.Struct({
    state: Schema.Literals(["bot-connected", "active"]),
    workspaceId: WorkspaceId,
    botUsername: Schema.NonEmptyString,
  }),
])
export type CoachContext = typeof CoachContext.Type

/**
 * Reads and writes workspaces through the `Database` seam and decodes rows into
 * domain entities. Apps never touch Drizzle directly (ADR 0002) — they depend on
 * this service. This is the reference the other repositories follow.
 */
export interface Interface {
  readonly findById: (id: WorkspaceId) => Effect.Effect<Workspace, WorkspaceNotFound | QueryFailed>
  readonly create: (workspace: Workspace) => Effect.Effect<Workspace, QueryFailed>
  readonly list: () => Effect.Effect<ReadonlyArray<ListItem>, QueryFailed>
  readonly getDetail: (id: WorkspaceId) => Effect.Effect<Detail, WorkspaceNotFound | QueryFailed>
  readonly findCoachByTelegramId: (
    telegramId: TelegramId,
  ) => Effect.Effect<CoachContext | undefined, QueryFailed>
  readonly rename: (
    input: RenameInput,
  ) => Effect.Effect<Detail, WorkspaceNotFound | UpdateConflict | QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/db/WorkspaceRepo") {}

export class UpdateConflict extends Schema.TaggedErrorClass<UpdateConflict>()(
  "WorkspaceRepo.UpdateConflict",
  {
    id: WorkspaceId,
  },
) {}

/**
 * `bot.connection_status` is snake_case in Postgres and kebab-case in the
 * domain; a missing bot row reads as the pre-provisioning state.
 */
const botConnectionStatus = (value: string | null): BotConnectionStatus =>
  value === null || value === "awaiting_setup"
    ? "awaiting-setup"
    : value === "needs_relink"
      ? "needs-relink"
      : "connected"

const decodeWorkspace = Schema.decodeUnknownEffect(Workspace)
const decodeList = Schema.decodeUnknownEffect(Schema.Array(ListItem))
const decodeDetail = Schema.decodeUnknownEffect(Detail)
const decodeCoachContext = Schema.decodeUnknownEffect(CoachContext)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    const findById = Effect.fn("WorkspaceRepo.findById")(function* (id: WorkspaceId) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ id: schema.workspace.id, name: schema.workspace.name })
            .from(schema.workspace)
            .where(eq(schema.workspace.id, id))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "findById", cause }),
      })

      return yield* decodeFirstRow(rows, "findById", decodeWorkspace, () =>
        Effect.fail(new WorkspaceNotFound({ id })),
      )
    })

    const create = Effect.fn("WorkspaceRepo.create")(function* (workspace: Workspace) {
      yield* Effect.tryPromise({
        try: () =>
          client.insert(schema.workspace).values({ id: workspace.id, name: workspace.name }),
        catch: (cause) => new QueryFailed({ operation: "create", cause }),
      })

      return workspace
    })

    /**
     * The owner member and the newest invite are one-per-workspace *in intent*
     * but not by constraint, so both are ranked and joined at rank 1 rather than
     * joined directly — a stray second row would otherwise silently duplicate a
     * coach in the list. Ranking keeps the whole aggregate in a single query.
     */
    const rankedOwner = client
      .select({
        workspaceId: schema.member.workspaceId,
        telegramUserId: schema.member.telegramUserId,
        termsAcceptedAt: schema.member.termsAcceptedAt,
        lastActivityAt: schema.member.lastActivityAt,
        rank: sql<number>`row_number() over (
          partition by ${schema.member.workspaceId} order by ${schema.member.createdAt} asc
        )`.as("owner_rank"),
      })
      .from(schema.member)
      .where(eq(schema.member.role, "owner"))
      .as("ranked_owner")

    const rankedInvite = client
      .select({
        workspaceId: schema.coachOnboardingInvite.workspaceId,
        id: schema.coachOnboardingInvite.id,
        code: schema.coachOnboardingInvite.code,
        status: schema.coachOnboardingInvite.status,
        issuedAt: schema.coachOnboardingInvite.issuedAt,
        expiresAt: schema.coachOnboardingInvite.expiresAt,
        acceptedAt: schema.coachOnboardingInvite.acceptedAt,
        acceptedByTelegramId: schema.coachOnboardingInvite.acceptedByTelegramId,
        cancelledAt: schema.coachOnboardingInvite.cancelledAt,
        cancellationReason: schema.coachOnboardingInvite.cancellationReason,
        delivery: schema.coachOnboardingInvite.delivery,
        rank: sql<number>`row_number() over (
          partition by ${schema.coachOnboardingInvite.workspaceId}
          order by ${schema.coachOnboardingInvite.issuedAt} desc
        )`.as("invite_rank"),
      })
      .from(schema.coachOnboardingInvite)
      .as("ranked_invite")

    const list = Effect.fn("WorkspaceRepo.list")(function* () {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              id: schema.workspace.id,
              name: schema.workspace.name,
              connectionStatus: schema.bot.connectionStatus,
              botUsername: schema.bot.username,
              ownerTelegramUserId: rankedOwner.telegramUserId,
              termsAcceptedAt: rankedOwner.termsAcceptedAt,
              lastActivityAt: rankedOwner.lastActivityAt,
              inviteId: rankedInvite.id,
              inviteCode: rankedInvite.code,
              inviteStatus: rankedInvite.status,
              inviteIssuedAt: rankedInvite.issuedAt,
              inviteExpiresAt: rankedInvite.expiresAt,
              inviteAcceptedAt: rankedInvite.acceptedAt,
              inviteAcceptedByTelegramId: rankedInvite.acceptedByTelegramId,
              inviteCancelledAt: rankedInvite.cancelledAt,
              inviteCancellationReason: rankedInvite.cancellationReason,
              inviteDelivery: rankedInvite.delivery,
            })
            .from(schema.workspace)
            .leftJoin(schema.bot, eq(schema.bot.workspaceId, schema.workspace.id))
            .leftJoin(
              rankedOwner,
              and(eq(rankedOwner.workspaceId, schema.workspace.id), eq(rankedOwner.rank, 1)),
            )
            .leftJoin(
              rankedInvite,
              and(eq(rankedInvite.workspaceId, schema.workspace.id), eq(rankedInvite.rank, 1)),
            )
            .orderBy(asc(schema.workspace.name)),
        catch: (cause) => new QueryFailed({ operation: "list", cause }),
      })

      const listItems = rows.map((row) => ({
        id: row.id,
        name: row.name,
        botStatus: botConnectionStatus(row.connectionStatus),
        ...(row.botUsername === null ? {} : { botUsername: row.botUsername }),
        ...(row.ownerTelegramUserId === null
          ? {}
          : { ownerTelegramUserId: row.ownerTelegramUserId }),
        ...(row.termsAcceptedAt === null ? {} : { termsAcceptedAt: row.termsAcceptedAt }),
        ...(row.lastActivityAt === null ? {} : { lastActivityAt: row.lastActivityAt }),
        ...(row.inviteId === null ||
        row.inviteCode === null ||
        row.inviteStatus === null ||
        row.inviteIssuedAt === null ||
        row.inviteExpiresAt === null
          ? {}
          : {
              invite: {
                id: row.inviteId,
                code: row.inviteCode,
                status: row.inviteStatus,
                issuedAt: row.inviteIssuedAt,
                expiresAt: row.inviteExpiresAt,
                ...(row.inviteAcceptedAt === null ? {} : { acceptedAt: row.inviteAcceptedAt }),
                ...(row.inviteAcceptedByTelegramId === null
                  ? {}
                  : { acceptedByTelegramId: row.inviteAcceptedByTelegramId }),
                ...(row.inviteCancelledAt === null ? {} : { cancelledAt: row.inviteCancelledAt }),
                ...(row.inviteCancellationReason === null
                  ? {}
                  : { cancellationReason: row.inviteCancellationReason }),
                ...(row.inviteDelivery === null ? {} : { delivery: row.inviteDelivery }),
              },
            }),
      }))

      return yield* decodeList(listItems).pipe(
        Effect.mapError((cause) => new QueryFailed({ operation: "list.decode", cause })),
      )
    })

    const getDetail = Effect.fn("WorkspaceRepo.getDetail")(function* (id: WorkspaceId) {
      const workspaceRows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              id: schema.workspace.id,
              name: schema.workspace.name,
              createdAt: schema.workspace.createdAt,
              updatedAt: schema.workspace.updatedAt,
              coachLanguage: schema.member.language,
              ownerTelegramUserId: schema.member.telegramUserId,
              memberCreatedAt: schema.member.createdAt,
              termsAcceptedAt: schema.member.termsAcceptedAt,
              lastLoginAt: schema.member.lastLoginAt,
              lastActivityAt: schema.member.lastActivityAt,
              connectionStatus: schema.bot.connectionStatus,
              botUsername: schema.bot.username,
            })
            .from(schema.workspace)
            .leftJoin(
              schema.member,
              and(
                eq(schema.member.workspaceId, schema.workspace.id),
                eq(schema.member.role, "owner"),
              ),
            )
            .leftJoin(schema.bot, eq(schema.bot.workspaceId, schema.workspace.id))
            .where(eq(schema.workspace.id, id))
            .orderBy(asc(schema.member.createdAt))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "getDetail", cause }),
      })
      const row = workspaceRows[0]
      if (row === undefined) return yield* new WorkspaceNotFound({ id })

      const inviteRows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              id: schema.coachOnboardingInvite.id,
              code: schema.coachOnboardingInvite.code,
              status: schema.coachOnboardingInvite.status,
              issuedAt: schema.coachOnboardingInvite.issuedAt,
              expiresAt: schema.coachOnboardingInvite.expiresAt,
              acceptedAt: schema.coachOnboardingInvite.acceptedAt,
              acceptedByTelegramId: schema.coachOnboardingInvite.acceptedByTelegramId,
              cancelledAt: schema.coachOnboardingInvite.cancelledAt,
              cancellationReason: schema.coachOnboardingInvite.cancellationReason,
              delivery: schema.coachOnboardingInvite.delivery,
            })
            .from(schema.coachOnboardingInvite)
            .where(eq(schema.coachOnboardingInvite.workspaceId, id))
            .orderBy(desc(schema.coachOnboardingInvite.issuedAt))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "getDetail.invite", cause }),
      })
      const invite = inviteRows[0]

      // "Joined" is when the coach's membership began — the owner member row's
      // creation, written when their bot connects. Deliberately *not* terms
      // acceptance: the details screen shows that as its own row, and two
      // labels over one timestamp would read as two facts (admin-surface.md).
      const joinedAt = row.memberCreatedAt

      return yield* decodeDetail({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ...(row.coachLanguage === null ? {} : { coachLanguage: row.coachLanguage }),
        ...(row.ownerTelegramUserId === null
          ? {}
          : { ownerTelegramUserId: row.ownerTelegramUserId }),
        ...(joinedAt === null ? {} : { joinedAt }),
        ...(row.termsAcceptedAt === null ? {} : { termsAcceptedAt: row.termsAcceptedAt }),
        ...(row.lastLoginAt === null ? {} : { lastLoginAt: row.lastLoginAt }),
        ...(row.lastActivityAt === null ? {} : { lastActivityAt: row.lastActivityAt }),
        botStatus: botConnectionStatus(row.connectionStatus),
        ...(row.botUsername === null ? {} : { botUsername: row.botUsername }),
        ...(invite === undefined
          ? {}
          : {
              invite: {
                id: invite.id,
                code: invite.code,
                status: invite.status,
                issuedAt: invite.issuedAt,
                expiresAt: invite.expiresAt,
                ...(invite.acceptedAt === null ? {} : { acceptedAt: invite.acceptedAt }),
                ...(invite.acceptedByTelegramId === null
                  ? {}
                  : { acceptedByTelegramId: invite.acceptedByTelegramId }),
                ...(invite.cancelledAt === null ? {} : { cancelledAt: invite.cancelledAt }),
                ...(invite.cancellationReason === null
                  ? {}
                  : { cancellationReason: invite.cancellationReason }),
                ...(invite.delivery === null ? {} : { delivery: invite.delivery }),
              },
            }),
      }).pipe(Effect.mapError((cause) => new QueryFailed({ operation: "getDetail.decode", cause })))
    })

    /**
     * The coach half of the entry role (#106), read from the two facts that can
     * tie a Telegram identity to a workspace: the owner membership its bot
     * connection wrote, and the invite claim that precedes it.
     *
     * Two constant-time lookups rather than one union: the second only runs for
     * an identity that owns no workspace, which is exactly the case where the
     * claim is the answer. Both tables hold one row per coach in MVP.
     *
     * An owner membership without a connected bot username cannot describe
     * either bot-bearing state, so it falls through to the claim rather than
     * inventing a bot the coach could not open.
     */
    const findCoachByTelegramId = Effect.fn("WorkspaceRepo.findCoachByTelegramId")(function* (
      telegramId: TelegramId,
    ) {
      const ownedRows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              workspaceId: schema.member.workspaceId,
              termsAcceptedAt: schema.member.termsAcceptedAt,
              botUsername: schema.bot.username,
            })
            .from(schema.member)
            .leftJoin(schema.bot, eq(schema.bot.workspaceId, schema.member.workspaceId))
            .where(
              and(eq(schema.member.role, "owner"), eq(schema.member.telegramUserId, telegramId)),
            ),
        catch: (cause) => new QueryFailed({ operation: "findCoachByTelegramId", cause }),
      })
      const owned = ownedRows.filter((row) => row.botUsername !== null)
      // The most advanced state wins: a finished workspace is the one worth
      // pointing at, even for an identity that somehow owns a second one.
      const active = owned.find((row) => row.termsAcceptedAt !== null) ?? owned[0]
      if (active !== undefined && active.botUsername !== null) {
        return yield* decodeCoachContext({
          state: active.termsAcceptedAt === null ? "bot-connected" : "active",
          workspaceId: active.workspaceId,
          botUsername: active.botUsername,
        }).pipe(
          Effect.mapError(
            (cause) => new QueryFailed({ operation: "findCoachByTelegramId.decode", cause }),
          ),
        )
      }

      const claimedRows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              workspaceId: schema.coachOnboardingInvite.workspaceId,
              code: schema.coachOnboardingInvite.code,
            })
            .from(schema.coachOnboardingInvite)
            .where(
              and(
                eq(schema.coachOnboardingInvite.status, "accepted"),
                eq(schema.coachOnboardingInvite.acceptedByTelegramId, telegramId),
              ),
            )
            .orderBy(desc(schema.coachOnboardingInvite.acceptedAt))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "findCoachByTelegramId.claim", cause }),
      })
      const claimed = claimedRows[0]
      if (claimed === undefined) return undefined

      return yield* decodeCoachContext({
        state: "accepted",
        workspaceId: claimed.workspaceId,
        code: claimed.code,
      }).pipe(
        Effect.mapError(
          (cause) => new QueryFailed({ operation: "findCoachByTelegramId.decode", cause }),
        ),
      )
    })

    /**
     * The internal label is the only workspace field an admin writes (#108).
     * The `updatedAt` comparison is the optimistic-concurrency check: a rename
     * against a stale version fails rather than clobbering a concurrent one.
     */
    const rename = Effect.fn("WorkspaceRepo.rename")(function* (input: RenameInput) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.workspace)
            .set({ name: input.name, updatedAt: input.now })
            .where(
              and(
                eq(schema.workspace.id, input.id),
                sql`date_trunc('milliseconds', ${schema.workspace.updatedAt}) = ${input.expectedUpdatedAt}`,
              ),
            )
            .returning({ id: schema.workspace.id }),
        catch: (cause) => new QueryFailed({ operation: "rename", cause }),
      })
      if (rows[0] !== undefined) return yield* getDetail(input.id)

      const existing = yield* Effect.result(findById(input.id))
      if (existing._tag === "Failure") {
        if (existing.failure._tag === "Domain.WorkspaceNotFound") return yield* existing.failure
        return yield* existing.failure
      }
      return yield* new UpdateConflict({ id: input.id })
    })

    return Service.of({ findById, create, list, getDetail, findCoachByTelegramId, rename })
  }),
)

export * as WorkspaceRepo from "./workspace-repo.ts"
