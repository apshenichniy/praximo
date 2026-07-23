import { WorkerEntrypoint } from "cloudflare:workers"
import {
  WorkspaceId,
  WorkspaceRunCancellationResult,
  type WorkspaceRunCancellationRpcClient,
} from "@praximo/domain"
import {
  type Env,
  handleObjectCleanupKickRpc,
  handleRequest,
  handleScheduled,
  handleWorkspaceRunCancellationRpc,
} from "./runtime.ts"

export default class PipelineWorker
  extends WorkerEntrypoint<Env>
  implements WorkspaceRunCancellationRpcClient
{
  override fetch(request: Request): Promise<Response> {
    return handleRequest(request, this.env)
  }

  cancelWorkspaceRuns(workspaceId: WorkspaceId): Promise<WorkspaceRunCancellationResult> {
    return handleWorkspaceRunCancellationRpc(this.env, workspaceId)
  }

  kickObjectCleanup(): Promise<void> {
    return handleObjectCleanupKickRpc(this.env)
  }

  override scheduled(): Promise<void> {
    return handleScheduled(this.env)
  }
}
