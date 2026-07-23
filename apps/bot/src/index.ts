import { WorkerEntrypoint } from "cloudflare:workers"
import { TelegramId } from "@praximo/domain"
import { ManagerBotSender } from "@praximo/telegram"
import { type Env, handleManagerTextRpc, handleRequest } from "./runtime.ts"

/**
 * The grammY Worker owns every Telegram credential and exposes manager-bot
 * delivery only through Cloudflare's internal native-RPC service binding.
 * Public HTTP remains limited to `/health`; inbound webhooks arrive in later
 * bot-provisioning tickets.
 */
export default class BotWorker extends WorkerEntrypoint<Env> implements ManagerBotSender.RpcClient {
  override fetch(request: Request): Promise<Response> {
    return handleRequest(request, this.env)
  }

  sendManagerText(recipient: TelegramId, text: string): Promise<ManagerBotSender.RpcResult> {
    return handleManagerTextRpc(this.env, recipient, text)
  }
}
