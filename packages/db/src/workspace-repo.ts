import {
  CoachLanguage,
  CoachOnboardingInviteId,
  CoachOnboardingInviteStatus,
  Workspace,
  WorkspaceId,
  WorkspaceNotFound,
} from "@praximo/domain"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database, decodeFirstRow, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

export const BotStatus = Schema.Literals(["provisioning", "connected", "needs-relink"])
export type BotStatus = typeof BotStatus.Type

export const ListItem = Schema.Struct({
  id: WorkspaceId,
  name: Schema.NonEmptyString,
  botStatus: BotStatus,
  botUsername: Schema.optionalKey(Schema.NonEmptyString),
  hasCustomAvatar: Schema.Boolean,
})
export interface ListItem extends Schema.Schema.Type<typeof ListItem> {}

export const Detail = Schema.Struct({
  id: WorkspaceId,
  name: Schema.NonEmptyString,
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
  botStatus: BotStatus,
  botUsername: Schema.optionalKey(Schema.NonEmptyString),
  invite: Schema.optionalKey(
    Schema.Struct({
      id: CoachOnboardingInviteId,
      status: CoachOnboardingInviteStatus,
      issuedAt: Schema.instanceOf(Date),
      expiresAt: Schema.instanceOf(Date),
    }),
  ),
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
            })
            .from(schema.workspace)
            .leftJoin(schema.bot, eq(schema.bot.workspaceId, schema.workspace.id))
            .orderBy(asc(schema.workspace.name)),
        catch: (cause) => new QueryFailed({ operation: "list", cause }),
      })

      const listItems = rows.map((row) => {
        const item: {
          id: string
          name: string
          botStatus: string
          botUsername?: string
          hasCustomAvatar: boolean
        } = {
          id: row.id,
          name: row.name,
          botStatus:
            row.connectionStatus === null || row.connectionStatus === "pending"
              ? "provisioning"
              : row.connectionStatus === "needs_relink"
                ? "needs-relink"
                : row.connectionStatus,
          hasCustomAvatar: row.avatarR2Key !== null,
        }

        if (row.botUsername !== null) item.botUsername = row.botUsername
        return item
      })

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
              status: schema.coachOnboardingInvite.status,
              issuedAt: schema.coachOnboardingInvite.issuedAt,
              expiresAt: schema.coachOnboardingInvite.expiresAt,
            })
            .from(schema.coachOnboardingInvite)
            .where(eq(schema.coachOnboardingInvite.workspaceId, id))
            .orderBy(desc(schema.coachOnboardingInvite.issuedAt))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "getDetail.invite", cause }),
      })
      const invite = inviteRows[0]
      const botStatus: BotStatus =
        row.connectionStatus === null || row.connectionStatus === "pending"
          ? "provisioning"
          : row.connectionStatus === "needs_relink"
            ? "needs-relink"
            : "connected"

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
        botStatus,
        ...(row.botUsername === null ? {} : { botUsername: row.botUsername }),
        ...(invite === undefined
          ? {}
          : {
              invite: {
                id: invite.id,
                status: invite.status,
                issuedAt: invite.issuedAt,
                expiresAt: invite.expiresAt,
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
