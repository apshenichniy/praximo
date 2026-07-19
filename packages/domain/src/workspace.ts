import { Schema } from "effect"

/**
 * A coach's practice and the unit of tenancy: every client, session, and
 * artifact belongs to exactly one workspace (CONTEXT.md).
 */
export const WorkspaceId = Schema.NonEmptyString.pipe(Schema.brand("WorkspaceId"))

export type WorkspaceId = typeof WorkspaceId.Type

export const Workspace = Schema.Struct({
  id: WorkspaceId,
  name: Schema.NonEmptyString,
})

export interface Workspace extends Schema.Schema.Type<typeof Workspace> {}

export class WorkspaceNotFound extends Schema.TaggedErrorClass<WorkspaceNotFound>()(
  "Domain.WorkspaceNotFound",
  {
    id: WorkspaceId,
  },
) {}
