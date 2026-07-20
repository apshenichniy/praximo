import { Workspace, WorkspaceId, WorkspaceNotFound } from "@praximo/domain"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database, decodeFirstRow, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

/**
 * Reads and writes workspaces through the `Database` seam and decodes rows into
 * domain entities. Apps never touch Drizzle directly (ADR 0002) — they depend on
 * this service. This is the reference the other repositories follow.
 */
export interface Interface {
  readonly findById: (id: WorkspaceId) => Effect.Effect<Workspace, WorkspaceNotFound | QueryFailed>
  readonly create: (workspace: Workspace) => Effect.Effect<Workspace, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/db/WorkspaceRepo") {}

const decodeWorkspace = Schema.decodeUnknownEffect(Workspace)

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

    return Service.of({ findById, create })
  }),
)

export * as WorkspaceRepo from "./workspace-repo.ts"
