import { ManagerInitData } from "@praximo/auth"
import { AdminRepo, Database, WorkspaceRepo } from "@praximo/db"
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"
import { AdminSurface } from "./admin-surface.ts"

interface Env {
  readonly DATABASE_URL: string
  readonly MANAGER_BOT_TOKEN: string
}

const RepositoriesLive = Layer.mergeAll(AdminRepo.layer, WorkspaceRepo.layer).pipe(
  Layer.provide(Database.layer),
)

const AppLive = AdminSurface.layer.pipe(
  Layer.provide(Layer.mergeAll(ManagerInitData.layer, RepositoriesLive)),
)

const runtimeFromEnv = (env: Env) =>
  ManagedRuntime.make(Layer.provide(AppLive, ConfigProvider.layer(ConfigProvider.fromUnknown(env))))

const requireString = (value: unknown, name: keyof Env): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing server binding ${name}`)
  }
  return value
}

const resolveEnv = async (): Promise<Env> => {
  if (typeof process !== "undefined" && process.env.DATABASE_URL && process.env.MANAGER_BOT_TOKEN) {
    return {
      DATABASE_URL: process.env.DATABASE_URL,
      MANAGER_BOT_TOKEN: process.env.MANAGER_BOT_TOKEN,
    }
  }

  const { env } = await import("cloudflare:workers")
  const workerEnv = env as unknown as Record<string, unknown>
  return {
    DATABASE_URL: requireString(workerEnv.DATABASE_URL, "DATABASE_URL"),
    MANAGER_BOT_TOKEN: requireString(workerEnv.MANAGER_BOT_TOKEN, "MANAGER_BOT_TOKEN"),
  }
}

let runtimePromise: Promise<ReturnType<typeof runtimeFromEnv>> | undefined

const getRuntime = () => (runtimePromise ??= resolveEnv().then(runtimeFromEnv))

export const listAdminWorkspaces = async (
  initData: string,
): Promise<ReadonlyArray<WorkspaceRepo.ListItem>> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) => service.listWorkspaces(initData)),
  )
}
