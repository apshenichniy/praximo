import { CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import {
  AdminRepo,
  CoachOnboardingRepo,
  Database,
  WorkspaceDeletionRepo,
  WorkspaceRepo,
} from "@praximo/db"
import type { WorkspaceRunCancellationRpcClient } from "@praximo/domain"
import { CoachBotRelease, ManagerBotSender } from "@praximo/telegram"
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"
import { AdminSurface } from "./admin-surface.ts"
import { canUseLocalProcessEnvironment } from "./runtime-environment.ts"
import { WorkspaceRunCancellation } from "./workspace-run-cancellation.ts"

interface Env {
  readonly DATABASE_URL: string
  readonly MANAGER_BOT_TOKEN: string
  readonly MANAGER_BOT_USERNAME: string
  readonly MANAGER_BOT?: ManagerBotSender.RpcClient & CoachBotRelease.RpcClient
  readonly PIPELINE?: WorkspaceRunCancellationRpcClient
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
    }
  }

  const { env } = await import("cloudflare:workers")
  const workerEnv = env as unknown as Record<string, unknown>
  return {
    DATABASE_URL: requireString(workerEnv.DATABASE_URL, "DATABASE_URL"),
    MANAGER_BOT_TOKEN: requireString(workerEnv.MANAGER_BOT_TOKEN, "MANAGER_BOT_TOKEN"),
    MANAGER_BOT_USERNAME: requireString(workerEnv.MANAGER_BOT_USERNAME, "MANAGER_BOT_USERNAME"),
    ...(workerEnv.MANAGER_BOT === undefined
      ? {}
      : {
          MANAGER_BOT: workerEnv.MANAGER_BOT as ManagerBotSender.RpcClient &
            CoachBotRelease.RpcClient,
        }),
    ...(workerEnv.PIPELINE === undefined
      ? {}
      : { PIPELINE: workerEnv.PIPELINE as WorkspaceRunCancellationRpcClient }),
  }
}

let runtimePromise: Promise<ReturnType<typeof runtimeFromEnv>> | undefined

const getRuntime = () => (runtimePromise ??= resolveEnv().then(runtimeFromEnv))

export const listAdminWorkspaces = async (
  initData: string,
): Promise<AdminSurface.CoachListResult> => {
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

export const getAdminWorkspace = async (initData: string, workspaceId: string) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) => service.getWorkspace(initData, workspaceId)),
  )
}

export const renameAdminWorkspace = async (
  initData: string,
  workspaceId: string,
  input: unknown,
) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) =>
      service.renameWorkspace(initData, workspaceId, input),
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

export const getAdminWorkspaceDeletion = async (initData: string, workspaceId: string) => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(AdminSurface.Service, (service) =>
      service.getWorkspaceDeletion(initData, workspaceId),
    ),
  )
}
