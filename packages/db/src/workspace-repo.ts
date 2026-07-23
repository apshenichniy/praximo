import { Workspace, WorkspaceId, WorkspaceNotFound } from "@praximo/domain"
import { asc, eq, min } from "drizzle-orm"
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
  ownerAvatarR2Key: Schema.optionalKey(Schema.NonEmptyString),
})
export interface ListItem extends Schema.Schema.Type<typeof ListItem> {}

/**
 * Reads and writes workspaces through the `Database` seam and decodes rows into
 * domain entities. Apps never touch Drizzle directly (ADR 0002) — they depend on
 * this service. This is the reference the other repositories follow.
 */
export interface Interface {
  readonly findById: (id: WorkspaceId) => Effect.Effect<Workspace, WorkspaceNotFound | QueryFailed>
  readonly create: (workspace: Workspace) => Effect.Effect<Workspace, QueryFailed>
  readonly list: () => Effect.Effect<ReadonlyArray<ListItem>, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/db/WorkspaceRepo") {}

const decodeWorkspace = Schema.decodeUnknownEffect(Workspace)
const decodeList = Schema.decodeUnknownEffect(Schema.Array(ListItem))

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
      const owner = client
        .select({
          workspaceId: schema.member.workspaceId,
          avatarR2Key: min(schema.member.avatarR2Key).as("avatar_r2_key"),
        })
        .from(schema.member)
        .where(eq(schema.member.role, "owner"))
        .groupBy(schema.member.workspaceId)
        .as("workspace_owner")

      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              id: schema.workspace.id,
              name: schema.workspace.name,
              connectionStatus: schema.bot.connectionStatus,
              botUsername: schema.bot.username,
              ownerAvatarR2Key: owner.avatarR2Key,
            })
            .from(schema.workspace)
            .leftJoin(schema.bot, eq(schema.bot.workspaceId, schema.workspace.id))
            .leftJoin(owner, eq(owner.workspaceId, schema.workspace.id))
            .orderBy(asc(schema.workspace.name)),
        catch: (cause) => new QueryFailed({ operation: "list", cause }),
      })

      const listItems = rows.map((row) => {
        const item: {
          id: string
          name: string
          botStatus: string
          botUsername?: string
          ownerAvatarR2Key?: string
        } = {
          id: row.id,
          name: row.name,
          botStatus:
            row.connectionStatus === null || row.connectionStatus === "pending"
              ? "provisioning"
              : row.connectionStatus === "needs_relink"
                ? "needs-relink"
                : row.connectionStatus,
        }

        if (row.botUsername !== null) item.botUsername = row.botUsername
        if (row.ownerAvatarR2Key !== null) {
          item.ownerAvatarR2Key = row.ownerAvatarR2Key
        }
        return item
      })

      return yield* decodeList(listItems).pipe(
        Effect.mapError((cause) => new QueryFailed({ operation: "list.decode", cause })),
      )
    })

    return Service.of({ findById, create, list })
  }),
)

export * as WorkspaceRepo from "./workspace-repo.ts"
