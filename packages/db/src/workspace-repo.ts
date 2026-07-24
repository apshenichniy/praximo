import {
  CoachLanguage,
  CoachOnboardingInviteCancellationReason,
  CoachOnboardingInviteCode,
  CoachOnboardingInviteId,
  CoachOnboardingInviteStatus,
  InviteDeliveryRecord,
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
  hasCustomAvatar: Schema.Boolean,
  /** Bound only once the coach's bot connects — not at invite acceptance. */
  ownerTelegramUserId: Schema.optionalKey(Schema.NonEmptyString),
  termsAcceptedAt: Schema.optionalKey(Schema.instanceOf(Date)),
  lastActivityAt: Schema.optionalKey(Schema.instanceOf(Date)),
  invite: Schema.optionalKey(ListInvite),
})
export interface ListItem extends Schema.Schema.Type<typeof ListItem> {}

export const Detail = Schema.Struct({
  id: WorkspaceId,
  name: Schema.String,
  avatarR2Key: Schema.optionalKey(Schema.NonEmptyString),
  description: Schema.optionalKey(Schema.String),
  shortDescription: Schema.optionalKey(Schema.String),
  createdAt: Schema.instanceOf(Date),
  updatedAt: Schema.instanceOf(Date),
  coachLanguage: Schema.optionalKey(CoachLanguage),
  ownerTelegramUserId: Schema.optionalKey(Schema.String),
  termsAcceptedAt: Schema.optionalKey(Schema.instanceOf(Date)),
  lastLoginAt: Schema.optionalKey(Schema.instanceOf(Date)),
  lastActivityAt: Schema.optionalKey(Schema.instanceOf(Date)),
  botStatus: BotConnectionStatus,
  botUsername: Schema.optionalKey(Schema.NonEmptyString),
  invite: Schema.optionalKey(ListInvite),
})
export interface Detail extends Schema.Schema.Type<typeof Detail> {}

export interface UpdateProfileInput {
  readonly id: WorkspaceId
  readonly expectedUpdatedAt: Date
  readonly name: string
  readonly description?: string
  readonly shortDescription?: string
  readonly avatarR2Key?: string
  readonly now: Date
}

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
  readonly updateProfile: (
    input: UpdateProfileInput,
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
              avatarR2Key: schema.workspace.avatarR2Key,
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
        hasCustomAvatar: row.avatarR2Key !== null,
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
              avatarR2Key: schema.workspace.avatarR2Key,
              description: schema.workspace.description,
              shortDescription: schema.workspace.shortDescription,
              createdAt: schema.workspace.createdAt,
              updatedAt: schema.workspace.updatedAt,
              coachLanguage: schema.member.language,
              ownerTelegramUserId: schema.member.telegramUserId,
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

      return yield* decodeDetail({
        id: row.id,
        name: row.name,
        ...(row.avatarR2Key === null ? {} : { avatarR2Key: row.avatarR2Key }),
        ...(row.description === null ? {} : { description: row.description }),
        ...(row.shortDescription === null ? {} : { shortDescription: row.shortDescription }),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ...(row.coachLanguage === null ? {} : { coachLanguage: row.coachLanguage }),
        ...(row.ownerTelegramUserId === null
          ? {}
          : { ownerTelegramUserId: row.ownerTelegramUserId }),
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

    const updateProfile = Effect.fn("WorkspaceRepo.updateProfile")(function* (
      input: UpdateProfileInput,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.workspace)
            .set({
              name: input.name,
              description: input.description ?? null,
              shortDescription: input.shortDescription ?? null,
              avatarR2Key: input.avatarR2Key ?? null,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(schema.workspace.id, input.id),
                sql`date_trunc('milliseconds', ${schema.workspace.updatedAt}) = ${input.expectedUpdatedAt}`,
              ),
            )
            .returning({ id: schema.workspace.id }),
        catch: (cause) => new QueryFailed({ operation: "updateProfile", cause }),
      })
      if (rows[0] !== undefined) return yield* getDetail(input.id)

      const existing = yield* Effect.result(findById(input.id))
      if (existing._tag === "Failure") {
        if (existing.failure._tag === "Domain.WorkspaceNotFound") return yield* existing.failure
        return yield* existing.failure
      }
      return yield* new UpdateConflict({ id: input.id })
    })

    return Service.of({ findById, create, list, getDetail, updateProfile })
  }),
)

export * as WorkspaceRepo from "./workspace-repo.ts"
