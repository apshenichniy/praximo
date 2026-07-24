import { Database, ObjectCleanupRepo, WorkspaceDeletionRepo, WorkspaceRepo } from "@praximo/db"
import { WorkspaceId, WorkspaceRunCancellationResult } from "@praximo/domain"
import { BotRegistry } from "@praximo/telegram"
import { Transcription } from "@praximo/transcription"
import { Deepgram } from "@praximo/transcription/deepgram"
import { Clock, ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"
import { type Bucket, ObjectCleanup } from "./object-cleanup.ts"

export interface Env {
  readonly DATABASE_URL: string
  readonly UPLOADS: Bucket
}

const appLayer = (env: Env) => {
  const databaseServices = Layer.mergeAll(
    WorkspaceRepo.layer,
    WorkspaceDeletionRepo.layer,
    ObjectCleanupRepo.layer,
  ).pipe(Layer.provide(Database.layer))

  return Layer.mergeAll(
    databaseServices,
    Deepgram.layer,
    BotRegistry.layer,
    ObjectCleanup.layer(env.UPLOADS).pipe(Layer.provide(databaseServices)),
  )
}

const runtimeFromEnv = (env: Env) =>
  ManagedRuntime.make(
    Layer.provide(appLayer(env), ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
  )

let runtime: ReturnType<typeof runtimeFromEnv> | undefined

const getRuntime = (env: Env) => (runtime ??= runtimeFromEnv(env))

const health = Effect.gen(function* () {
  yield* WorkspaceRepo.Service
  yield* Transcription.Service
  yield* BotRegistry.Service
  yield* ObjectCleanup.Service

  return { app: "pipeline", status: "ok" } as const
})

const runCleanup = Effect.fn("Pipeline.runCleanup")(function* () {
  const cleanup = yield* ObjectCleanup.Service
  yield* cleanup.runOnce()
})

const runScheduledMaintenance = Effect.fn("Pipeline.runScheduledMaintenance")(function* () {
  yield* runCleanup()
  const deletion = yield* WorkspaceDeletionRepo.Service
  yield* deletion.reconcileOrphans()
  yield* deletion.purgeExpired(new Date(yield* Clock.currentTimeMillis))
})

export const handleRequest = async (request: Request, env: Env): Promise<Response> => {
  if (new URL(request.url).pathname !== "/health") return new Response(null, { status: 404 })
  return Response.json(await getRuntime(env).runPromise(health))
}

export const handleWorkspaceRunCancellationRpc = (
  _env: Env,
  _workspaceId: WorkspaceId,
): Promise<WorkspaceRunCancellationResult> =>
  Promise.resolve(WorkspaceRunCancellationResult.cases.NothingActive.make({}))

export const handleObjectCleanupKickRpc = (env: Env): Promise<void> =>
  getRuntime(env).runPromise(runCleanup())

export const handleScheduled = (env: Env): Promise<void> =>
  getRuntime(env).runPromise(runScheduledMaintenance())
