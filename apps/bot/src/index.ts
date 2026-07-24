import { WorkerEntrypoint } from "cloudflare:workers"
import { TelegramId, WorkspaceId } from "@praximo/domain"
import { CoachBotBranding, CoachBotRelease, ManagerBotSender } from "@praximo/telegram"
import {
  type Env,
  handleCoachBotBrandingRpc,
  handleCoachBotReleaseRpc,
  handleManagerInlineInviteRpc,
  handleManagerTextRpc,
  handleRequest,
  handleScheduled,
} from "./runtime.ts"

/**
 * The grammY Worker owns every Telegram credential and exposes manager-bot
 * delivery only through Cloudflare's internal native-RPC service binding.
 * Public HTTP remains limited to `/health`; inbound webhooks arrive in later
 * bot-provisioning tickets.
 */
export default class BotWorker
  extends WorkerEntrypoint<Env>
  implements ManagerBotSender.RpcClient, CoachBotBranding.RpcClient, CoachBotRelease.RpcClient
{
  override fetch(request: Request): Promise<Response> {
    return handleRequest(request, this.env)
  }

  override scheduled(_controller: ScheduledController): Promise<void> {
    return handleScheduled(this.env)
  }

  sendManagerText(recipient: TelegramId, text: string): Promise<ManagerBotSender.RpcResult> {
    return handleManagerTextRpc(this.env, recipient, text)
  }

  prepareManagerInlineInvite(
    recipient: TelegramId,
    invite: ManagerBotSender.InlineInvite,
  ): Promise<ManagerBotSender.PrepareRpcResult> {
    return handleManagerInlineInviteRpc(this.env, recipient, invite)
  }

  applyCoachBotBranding(profile: CoachBotBranding.Profile): Promise<CoachBotBranding.RpcResult> {
    return handleCoachBotBrandingRpc(this.env, profile)
  }

  releaseCoachBot(workspaceId: WorkspaceId): Promise<CoachBotRelease.Result> {
    return handleCoachBotReleaseRpc(this.env, workspaceId)
  }
}
