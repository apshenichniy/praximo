import { WorkerEntrypoint } from "cloudflare:workers"
import { TelegramId, WorkspaceId } from "@praximo/domain"
import { BotRegistry, CoachBotRelease, ManagerBotSender } from "@praximo/telegram"
import {
  type Env,
  handleCoachBotReleaseRpc,
  handleCoachInviteCardRpc,
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
  implements ManagerBotSender.RpcClient, CoachBotRelease.RpcClient, BotRegistry.RpcClient
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

  releaseCoachBot(workspaceId: WorkspaceId): Promise<CoachBotRelease.Result> {
    return handleCoachBotReleaseRpc(this.env, workspaceId)
  }

  /**
   * The one method the coach Mini App's share needs (#179): the card has to be
   * authored by the workspace's *own* bot, whose credential never leaves this
   * Worker.
   */
  prepareCoachInviteCard(
    workspace: WorkspaceId,
    card: BotRegistry.InviteCard,
  ): Promise<BotRegistry.PrepareCardRpcResult> {
    return handleCoachInviteCardRpc(this.env, workspace, card)
  }
}
