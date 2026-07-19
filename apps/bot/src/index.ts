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

export const handleRequest = async (): Promise<Response> =>
  Response.json(await runtime.runPromise(health))

export default { fetch: handleRequest } satisfies ExportedHandler
