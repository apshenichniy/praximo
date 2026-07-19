import { MiniAppSession } from "@praximo/auth"
import { WorkspaceRepo } from "@praximo/db"
import { Effect, Layer, ManagedRuntime } from "effect"

/**
 * The coach UI, the Telegram Mini App, and the web room (ADR 0002). TanStack
 * Start arrives with its own ticket; this entrypoint only proves the layer graph
 * composes and a runtime boots on workerd.
 *
 * Effect runs server-side only here — client React stays Effect-free (ADR 0002).
 */
const AppLive = Layer.mergeAll(WorkspaceRepo.layer, MiniAppSession.layer)

/** Exactly one runtime per Worker entrypoint (ADR 0002). */
const runtime = ManagedRuntime.make(AppLive)

const health = Effect.gen(function* () {
  yield* WorkspaceRepo.Service
  yield* MiniAppSession.Service

  return { app: "web", status: "ok" } as const
})

export const handleRequest = async (_request: Request): Promise<Response> =>
  Response.json(await runtime.runPromise(health))

export default { fetch: handleRequest } satisfies ExportedHandler
