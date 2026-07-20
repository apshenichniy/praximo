import { Database, WorkspaceRepo } from "@praximo/db"
import { BotRegistry } from "@praximo/telegram"
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"

/**
 * The grammY webhook Worker serving every per-coach bot through per-bot webhook
 * paths and secret tokens (ADR 0002). Bot provisioning and the grammY client
 * arrive with their own tickets; this entrypoint only proves the layer graph
 * composes and a runtime boots on workerd.
 */
interface Env {
  readonly DATABASE_URL: string
}

// WorkspaceRepo now reads through the real Neon connection (#47); Database
// resolves its `DATABASE_URL` from the app's own ConfigProvider over the Worker
// env (ADR 0002), not the ambient environment.
const AppLive = Layer.mergeAll(
  WorkspaceRepo.layer.pipe(Layer.provide(Database.layer)),
  BotRegistry.layer,
)

const runtimeFromEnv = (env: Env) =>
  ManagedRuntime.make(Layer.provide(AppLive, ConfigProvider.layer(ConfigProvider.fromUnknown(env))))

/** Exactly one runtime per Worker entrypoint (ADR 0002), built from `env` once. */
let runtime: ReturnType<typeof runtimeFromEnv> | undefined

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
export const handleRequest = async (request: Request, env: Env): Promise<Response> => {
  if (new URL(request.url).pathname !== "/health") return new Response(null, { status: 404 })

  runtime ??= runtimeFromEnv(env)
  return Response.json(await runtime.runPromise(health))
}

export default { fetch: handleRequest } satisfies ExportedHandler<Env>
