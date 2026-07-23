import { CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import { AdminRepo, CoachOnboardingRepo, Database, WorkspaceRepo } from "@praximo/db"
import { ManagerBotSender } from "@praximo/telegram"
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"
import { AdminSurface } from "./admin-surface.ts"
import { canUseLocalProcessEnvironment } from "./runtime-environment.ts"
import { type Bucket, WorkspaceBrandingStorage } from "./workspace-branding-storage.ts"

interface Env {
  readonly DATABASE_URL: string
  readonly MANAGER_BOT_TOKEN: string
  readonly MANAGER_BOT_USERNAME: string
  readonly COACH_ONBOARDING_TOKEN_SECRET: string
  readonly DEFAULT_COACH_BOT_AVATAR_R2_KEY: string
  readonly MANAGER_BOT?: ManagerBotSender.RpcClient
  readonly UPLOADS: Bucket
}

const runtimeFromEnv = (env: Env) => {
  const repositories = Layer.mergeAll(
    AdminRepo.layer,
    WorkspaceRepo.layer,
    CoachOnboardingRepo.layer,
  ).pipe(Layer.provide(Database.layer))
  const sender =
    env.MANAGER_BOT === undefined
      ? ManagerBotSender.layer
      : ManagerBotSender.rpcLayer(env.MANAGER_BOT)
  const dependencies = Layer.mergeAll(
    ManagerInitData.layer,
    CoachOnboardingToken.layer,
    WorkspaceBrandingStorage.layer(env.UPLOADS),
    sender,
    repositories,
  )
  const app = AdminSurface.layer.pipe(Layer.provide(dependencies))
  return ManagedRuntime.make(
    Layer.provide(app, ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
  )
}

const requireString = (value: unknown, name: keyof Env): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing server binding ${name}`)
  }
  return value
}

const resolveEnv = async (): Promise<Env> => {
  if (
    typeof process !== "undefined" &&
    canUseLocalProcessEnvironment(import.meta.env.DEV, process.env)
  ) {
    return {
      DATABASE_URL: requireString(process.env.DATABASE_URL, "DATABASE_URL"),
      MANAGER_BOT_TOKEN: requireString(process.env.MANAGER_BOT_TOKEN, "MANAGER_BOT_TOKEN"),
      MANAGER_BOT_USERNAME: requireString(process.env.MANAGER_BOT_USERNAME, "MANAGER_BOT_USERNAME"),
      COACH_ONBOARDING_TOKEN_SECRET: requireString(
        process.env.COACH_ONBOARDING_TOKEN_SECRET,
        "COACH_ONBOARDING_TOKEN_SECRET",
      ),
      DEFAULT_COACH_BOT_AVATAR_R2_KEY: requireString(
        process.env.DEFAULT_COACH_BOT_AVATAR_R2_KEY,
        "DEFAULT_COACH_BOT_AVATAR_R2_KEY",
      ),
      UPLOADS: {
        put: async () => {
          throw new Error("UPLOADS is unavailable in the local Vite runtime")
        },
        delete: async () => {
          throw new Error("UPLOADS is unavailable in the local Vite runtime")
        },
      },
    }
  }

  const { env } = await import("cloudflare:workers")
  const workerEnv = env as unknown as Record<string, unknown>
  return {
    DATABASE_URL: requireString(workerEnv.DATABASE_URL, "DATABASE_URL"),
    MANAGER_BOT_TOKEN: requireString(workerEnv.MANAGER_BOT_TOKEN, "MANAGER_BOT_TOKEN"),
    MANAGER_BOT_USERNAME: requireString(workerEnv.MANAGER_BOT_USERNAME, "MANAGER_BOT_USERNAME"),
    COACH_ONBOARDING_TOKEN_SECRET: requireString(
      workerEnv.COACH_ONBOARDING_TOKEN_SECRET,
      "COACH_ONBOARDING_TOKEN_SECRET",
    ),
    DEFAULT_COACH_BOT_AVATAR_R2_KEY: requireString(
      workerEnv.DEFAULT_COACH_BOT_AVATAR_R2_KEY,
      "DEFAULT_COACH_BOT_AVATAR_R2_KEY",
    ),
    ...(workerEnv.MANAGER_BOT === undefined
      ? {}
      : { MANAGER_BOT: workerEnv.MANAGER_BOT as ManagerBotSender.RpcClient }),
    UPLOADS: (() => {
      if (workerEnv.UPLOADS === undefined) throw new Error("missing server binding UPLOADS")
      return workerEnv.UPLOADS as Bucket
    })(),
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

export const createAdminWorkspace = async (
  initData: string,
  input: unknown,
  avatar?: Uint8Array,
) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) =>
      service.createWorkspace(initData, input, avatar),
    ),
  )
}

export const resendAdminWorkspaceInvite = async (initData: string, inviteId: string) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) => service.resendInvite(initData, inviteId)),
  )
}
