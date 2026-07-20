import { WorkspaceRepo } from "@praximo/db"
import { BotRegistry } from "@praximo/telegram"
import { Effect, Layer, ManagedRuntime } from "effect"

/**
 * The grammY webhook Worker serving every per-coach bot through per-bot webhook
 * paths and secret tokens (ADR 0002). Bot provisioning and the grammY client
 * arrive with their own tickets; this entrypoint only proves the layer graph
 * composes and a runtime boots on workerd.
 */
const AppLive = Layer.mergeAll(WorkspaceRepo.layer, BotRegistry.layer)

/** Exactly one runtime per Worker entrypoint (ADR 0002). */
const runtime = ManagedRuntime.make(AppLive)

const health = Effect.gen(function* () {
  yield* WorkspaceRepo.Service
  yield* BotRegistry.Service

  return { app: "bot", status: "ok" } as const
})

/**
 * The dev-stack health route (#46): proves the deployed Worker booted its
 * runtime and the layer graph resolved on real infrastructure. Every other path
 * 404s until the real webhook routing arrives with the bot-provisioning ticket.
 */
export const handleRequest = async (request: Request): Promise<Response> => {
  if (new URL(request.url).pathname !== "/health") return new Response(null, { status: 404 })

  return Response.json(await runtime.runPromise(health))
}

export default { fetch: handleRequest } satisfies ExportedHandler
