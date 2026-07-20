import { MiniAppSession } from "@praximo/auth"
import { Database, WorkspaceRepo } from "@praximo/db"
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"

/**
 * The coach UI, the Telegram Mini App, and the web room (ADR 0002). TanStack
 * Start arrives with its own ticket; this entrypoint only proves the layer graph
 * composes and a runtime boots on workerd.
 *
 * Effect runs server-side only here — client React stays Effect-free (ADR 0002).
 */
interface Env {
  readonly DATABASE_URL: string
}

// WorkspaceRepo now reads through the real Neon connection (#47); Database
// resolves its `DATABASE_URL` from the app's own ConfigProvider over the Worker
// env (ADR 0002), not the ambient environment.
const AppLive = Layer.mergeAll(
  WorkspaceRepo.layer.pipe(Layer.provide(Database.layer)),
  MiniAppSession.layer,
)

const runtimeFromEnv = (env: Env) =>
  ManagedRuntime.make(Layer.provide(AppLive, ConfigProvider.layer(ConfigProvider.fromUnknown(env))))

/** Exactly one runtime per Worker entrypoint (ADR 0002), built from `env` once. */
let runtime: ReturnType<typeof runtimeFromEnv> | undefined

const health = Effect.gen(function* () {
  yield* WorkspaceRepo.Service
  yield* MiniAppSession.Service

  return { app: "web", status: "ok" } as const
})

/**
 * The dev-stack health route (#46): proves the deployed Worker booted its
 * runtime and the layer graph resolved on real infrastructure. Every other path
 * 404s until the real routing arrives with the Mini App ticket.
 */
export const handleRequest = async (request: Request, env: Env): Promise<Response> => {
  if (new URL(request.url).pathname !== "/health") return new Response(null, { status: 404 })

  runtime ??= runtimeFromEnv(env)
  return Response.json(await runtime.runPromise(health))
}

export default { fetch: handleRequest } satisfies ExportedHandler<Env>
