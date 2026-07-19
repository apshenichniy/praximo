import { Workspace, WorkspaceId, WorkspaceNotFound } from "@praximo/domain"
import { Context, Effect, Layer, Schema } from "effect"

/**
 * Reads workspaces out of Postgres and decodes rows into domain entities.
 * Apps never touch Drizzle directly (ADR 0002) — they depend on this service.
 */
export interface Interface {
  readonly findById: (id: WorkspaceId) => Effect.Effect<Workspace, WorkspaceNotFound | QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/db/WorkspaceRepo") {}

export class QueryFailed extends Schema.TaggedErrorClass<QueryFailed>()(
  "WorkspaceRepo.QueryFailed",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/**
 * Unwired until the Drizzle schema and the Neon connection arrive with their
 * own ticket; resolving the service must not imply a working database.
 */
export const layer = Layer.sync(Service, () => {
  const findById = Effect.fn("WorkspaceRepo.findById")(function* (_id: WorkspaceId) {
    return yield* Effect.fail(
      new QueryFailed({
        operation: "findById",
        cause: new Error("the database is not wired yet"),
      }),
    )
  })

  return Service.of({ findById })
})

export * as WorkspaceRepo from "./workspace-repo.ts"
