import { Schema } from "effect"
import { WorkspaceId } from "./workspace.ts"

export const WorkspaceDeletionRequestId = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("WorkspaceDeletionRequestId"),
)
export type WorkspaceDeletionRequestId = typeof WorkspaceDeletionRequestId.Type

export const DeleteWorkspaceInput = Schema.Struct({
  requestId: WorkspaceDeletionRequestId,
  confirmationName: Schema.String,
})
export interface DeleteWorkspaceInput extends Schema.Schema.Type<typeof DeleteWorkspaceInput> {}

export const WorkspaceRunCancellationResult = Schema.TaggedUnion({
  Cancelled: {},
  NothingActive: {},
  Failed: {},
})
export type WorkspaceRunCancellationResult = typeof WorkspaceRunCancellationResult.Type

export interface WorkspaceRunCancellationRpcClient {
  readonly cancelWorkspaceRuns: (
    workspaceId: WorkspaceId,
  ) => Promise<WorkspaceRunCancellationResult>
  readonly kickObjectCleanup: () => Promise<void>
}
