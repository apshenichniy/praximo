import { CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import {
  AdminRepo,
  CoachOnboardingRepo,
  Database,
  WorkspaceDeletionRepo,
  WorkspaceRepo,
} from "@praximo/db"
import type { WorkspaceRunCancellationRpcClient } from "@praximo/domain"
import { CoachBotBranding, CoachBotRelease, ManagerBotSender } from "@praximo/telegram"
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"
import { AdminSurface } from "./admin-surface.ts"
import { canUseLocalProcessEnvironment } from "./runtime-environment.ts"
import { type Bucket, WorkspaceBrandingStorage } from "./workspace-branding-storage.ts"
import { WorkspaceRunCancellation } from "./workspace-run-cancellation.ts"

interface Env {
  readonly DATABASE_URL: string
  readonly MANAGER_BOT_TOKEN: string
  readonly MANAGER_BOT_USERNAME: string
  readonly DEFAULT_COACH_BOT_AVATAR_R2_KEY: string
  readonly MANAGER_BOT?: ManagerBotSender.RpcClient &
    CoachBotBranding.RpcClient &
    CoachBotRelease.RpcClient
  readonly PIPELINE?: WorkspaceRunCancellationRpcClient
  readonly UPLOADS: Bucket
}

const runtimeFromEnv = (env: Env) => {
  const repositories = Layer.mergeAll(
    AdminRepo.layer,
    WorkspaceRepo.layer,
    CoachOnboardingRepo.layer,
    WorkspaceDeletionRepo.layer,
  ).pipe(Layer.provide(Database.layer))
  const sender =
    env.MANAGER_BOT === undefined
      ? ManagerBotSender.layer
      : ManagerBotSender.rpcLayer(env.MANAGER_BOT)
  const branding =
    env.MANAGER_BOT === undefined
      ? CoachBotBranding.layer
      : CoachBotBranding.rpcLayer(env.MANAGER_BOT)
  const coachBotRelease =
    env.MANAGER_BOT === undefined
      ? CoachBotRelease.layer
      : CoachBotRelease.rpcLayer(env.MANAGER_BOT)
  const runCancellation =
    env.PIPELINE === undefined
      ? WorkspaceRunCancellation.layer
      : WorkspaceRunCancellation.rpcLayer(env.PIPELINE)
  const dependencies = Layer.mergeAll(
    ManagerInitData.layer,
    CoachOnboardingToken.layer,
    WorkspaceBrandingStorage.layer(env.UPLOADS),
    branding,
    sender,
    coachBotRelease,
    runCancellation,
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
        get: async () => {
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
    DEFAULT_COACH_BOT_AVATAR_R2_KEY: requireString(
      workerEnv.DEFAULT_COACH_BOT_AVATAR_R2_KEY,
      "DEFAULT_COACH_BOT_AVATAR_R2_KEY",
    ),
    ...(workerEnv.MANAGER_BOT === undefined
      ? {}
      : {
          MANAGER_BOT: workerEnv.MANAGER_BOT as ManagerBotSender.RpcClient &
            CoachBotBranding.RpcClient &
            CoachBotRelease.RpcClient,
        }),
    ...(workerEnv.PIPELINE === undefined
      ? {}
      : { PIPELINE: workerEnv.PIPELINE as WorkspaceRunCancellationRpcClient }),
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

export const createAdminWorkspace = async (initData: string, input: unknown, delivery: unknown) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) =>
      service.createWorkspace(initData, input, delivery),
    ),
  )
}

export const prepareAdminInviteShareMessage = async (
  initData: string,
  inviteId: string,
  language: unknown,
) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) =>
      service.prepareInviteShareMessage(initData, inviteId, language),
    ),
  )
}

export const recordAdminInviteShare = async (
  initData: string,
  inviteId: string,
  language: unknown,
) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) =>
      service.recordInviteShare(initData, inviteId, language),
    ),
  )
}

export const resendAdminWorkspaceInvite = async (initData: string, inviteId: string) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) => service.resendInvite(initData, inviteId)),
  )
}

export const getAdminWorkspace = async (initData: string, workspaceId: string) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) => service.getWorkspace(initData, workspaceId)),
  )
}

export const getAdminWorkspaceAvatar = async (initData: string, workspaceId: string) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) =>
      service.getWorkspaceAvatar(initData, workspaceId),
    ),
  )
}

export const updateAdminWorkspaceProfile = async (
  initData: string,
  workspaceId: string,
  input: unknown,
  avatar?: Uint8Array,
) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) =>
      service.updateWorkspaceProfile(initData, workspaceId, input, avatar),
    ),
  )
}

export const retryAdminWorkspaceBranding = async (
  initData: string,
  workspaceId: string,
  retryAvatar: boolean,
) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) =>
      service.retryWorkspaceBranding(initData, workspaceId, retryAvatar),
    ),
  )
}

export const reissueAdminWorkspaceInvite = async (
  initData: string,
  workspaceId: string,
  expectedInviteId: string,
  requestId: string,
) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) =>
      service.reissueWorkspaceInvite(initData, workspaceId, expectedInviteId, requestId),
    ),
  )
}

export const deleteAdminWorkspace = async (
  initData: string,
  workspaceId: string,
  input: unknown,
) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) =>
      service.deleteWorkspace(initData, workspaceId, input),
    ),
  )
}
