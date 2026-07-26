import { CoachInitData, CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import {
  AdminRepo,
  ClientRepo,
  CoachOnboardingRepo,
  Database,
  MemberRepo,
  SessionRepo,
  WorkspaceDeletionRepo,
  WorkspaceRepo,
} from "@praximo/db"
import type { WorkspaceRunCancellationRpcClient } from "@praximo/domain"
import { BotRegistry, CoachBotRelease, ManagerBotSender } from "@praximo/telegram"
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"
import { AdminSurface } from "./admin-surface.ts"
import { CoachClients } from "./coach-clients.ts"
import { CoachSession } from "./coach-session.ts"
import { CoachSessions } from "./coach-sessions.ts"
import { CoachSurface } from "./coach-surface.ts"
import type { LaunchCredential } from "./launch-credential.ts"
import { canUseLocalProcessEnvironment } from "./runtime-environment.ts"
import { ViewerRole } from "./viewer-role.ts"
import { WorkspaceRunCancellation } from "./workspace-run-cancellation.ts"

/**
 * Everything this Worker asks of the bot Worker across the one binding they
 * share: manager-bot delivery, coach-bot release, and — since #179 — a card
 * authored by a coach's own bot. Named once, because a binding that grows a
 * capability must grow it in exactly one place.
 */
type BotWorkerBinding = ManagerBotSender.RpcClient &
  CoachBotRelease.RpcClient &
  BotRegistry.RpcClient

interface Env {
  readonly DATABASE_URL: string
  readonly MANAGER_BOT_TOKEN: string
  readonly MANAGER_BOT_USERNAME: string
  /** Selects Telegram's Ed25519 public key for the coach path (ADR 0006). */
  readonly TELEGRAM_ENV: string
  /**
   * Local development only: the public half of the throwaway pair the dev
   * credential minter signs with. Absent everywhere else, and the branch that
   * populates it folds out of a production build.
   */
  readonly COACH_DEV_PUBLIC_KEY?: string
  readonly MANAGER_BOT?: BotWorkerBinding
  readonly PIPELINE?: WorkspaceRunCancellationRpcClient
}

const runtimeFromEnv = (env: Env) => {
  const repositories = Layer.mergeAll(
    AdminRepo.layer,
    WorkspaceRepo.layer,
    CoachOnboardingRepo.layer,
    WorkspaceDeletionRepo.layer,
    MemberRepo.layer,
    ClientRepo.layer,
    SessionRepo.layer,
  ).pipe(Layer.provide(Database.layer))
  const sender =
    env.MANAGER_BOT === undefined
      ? ManagerBotSender.layer
      : ManagerBotSender.rpcLayer(env.MANAGER_BOT)
  const coachBotRelease =
    env.MANAGER_BOT === undefined
      ? CoachBotRelease.layer
      : CoachBotRelease.rpcLayer(env.MANAGER_BOT)
  // The coach's own bot, reached the only way it can be: its credential never
  // leaves the bot Worker, so authoring a card is a call across the binding
  // rather than a second decryption over here (#179).
  const coachBots =
    env.MANAGER_BOT === undefined ? BotRegistry.layer : BotRegistry.rpcLayer(env.MANAGER_BOT)
  const runCancellation =
    env.PIPELINE === undefined
      ? WorkspaceRunCancellation.layer
      : WorkspaceRunCancellation.rpcLayer(env.PIPELINE)
  // Config *selects* Telegram's trust anchor from two keys already in source;
  // development anchors on the throwaway key it also signs with. Either way the
  // real verifier runs — a wrong public key can only make verification fail.
  const coachInitData =
    env.COACH_DEV_PUBLIC_KEY === undefined
      ? CoachInitData.layer
      : CoachInitData.testLayer(env.COACH_DEV_PUBLIC_KEY)
  const dependencies = Layer.mergeAll(
    ManagerInitData.layer,
    coachInitData,
    CoachOnboardingToken.layer,
    sender,
    coachBotRelease,
    coachBots,
    runCancellation,
    repositories,
  )
  const app = Layer.mergeAll(
    AdminSurface.layer,
    ViewerRole.layer,
    CoachSurface.layer.pipe(Layer.provide(CoachSession.layer)),
    CoachClients.layer.pipe(Layer.provide(CoachSession.layer)),
    CoachSessions.layer.pipe(Layer.provide(CoachSession.layer)),
  ).pipe(Layer.provide(dependencies))
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
      TELEGRAM_ENV: requireString(process.env.TELEGRAM_ENV, "TELEGRAM_ENV"),
      // The guard is a bare `import.meta.env.DEV`, not the binding-source check
      // above it: only a foldable constant lets Vite drop the dynamic import and
      // with it every line of the development credential minter. A call whose
      // argument happens to be `false` keeps the module in the bundle.
      ...(import.meta.env.DEV
        ? {
            COACH_DEV_PUBLIC_KEY: await import("./development-coach-credential.ts").then((module) =>
              module.developmentCoachPublicKey(),
            ),
          }
        : {}),
    }
  }

  const { env } = await import("cloudflare:workers")
  const workerEnv = env as unknown as Record<string, unknown>
  return {
    DATABASE_URL: requireString(workerEnv.DATABASE_URL, "DATABASE_URL"),
    MANAGER_BOT_TOKEN: requireString(workerEnv.MANAGER_BOT_TOKEN, "MANAGER_BOT_TOKEN"),
    MANAGER_BOT_USERNAME: requireString(workerEnv.MANAGER_BOT_USERNAME, "MANAGER_BOT_USERNAME"),
    TELEGRAM_ENV: requireString(workerEnv.TELEGRAM_ENV, "TELEGRAM_ENV"),
    ...(workerEnv.MANAGER_BOT === undefined
      ? {}
      : { MANAGER_BOT: workerEnv.MANAGER_BOT as BotWorkerBinding }),
    ...(workerEnv.PIPELINE === undefined
      ? {}
      : { PIPELINE: workerEnv.PIPELINE as WorkspaceRunCancellationRpcClient }),
  }
}

let runtimePromise: Promise<ReturnType<typeof runtimeFromEnv>> | undefined

const getRuntime = () => (runtimePromise ??= resolveEnv().then(runtimeFromEnv))

/** The manager Mini App's entry gate (#106) — the one call every viewer makes. */
export const resolveViewerRole = async (initData: string): Promise<ViewerRole.Role> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(ViewerRole.Service, (service) => service.resolveRole(initData)),
  )
}

/** The coach Mini App's entry (#54) — the one call every coach launch makes. */
export const openCoachApp = async (
  credential: LaunchCredential,
): Promise<CoachSurface.CoachEntry> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachSurface.Service, (service) => service.openApp(credential)),
  )
}

export const acceptCoachTerms = async (
  credential: LaunchCredential,
  version: unknown,
): Promise<CoachSurface.CoachEntry> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachSurface.Service, (service) => service.acceptTerms(credential, version)),
  )
}

/** The coach's own choice of the language Praximo speaks to them (#130). */
export const chooseCoachLanguage = async (
  credential: LaunchCredential,
  language: unknown,
): Promise<CoachSurface.CoachEntry> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachSurface.Service, (service) => service.chooseLanguage(credential, language)),
  )
}

/** The coach's own practice — the list, one client, and everything they do to it (#56). */
export const loadCoachClients = async (
  credential: LaunchCredential,
): Promise<CoachClients.CoachClientsHome> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) => service.home(credential)),
  )
}

export const loadCoachClientDetail = async (
  credential: LaunchCredential,
  clientId: string,
): Promise<CoachClients.ClientDetail | undefined> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) => service.detail(credential, clientId)),
  )
}

export const createCoachClient = async (
  credential: LaunchCredential,
  input: unknown,
): Promise<{ readonly clientId: string }> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) => service.create(credential, input)),
  )
}

export const loadCoachDaySchedule = async (
  credential: LaunchCredential,
  date: string,
): Promise<CoachClients.DaySchedule> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) => service.daySchedule(credential, date)),
  )
}

export const loadCoachRangeSchedule = async (
  credential: LaunchCredential,
  from: string,
  days: number,
): Promise<ReadonlyArray<CoachClients.DatedDaySchedule>> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) =>
      service.rangeSchedule(credential, from, days),
    ),
  )
}

export const scheduleCoachSession = async (
  credential: LaunchCredential,
  input: CoachClients.ScheduleSessionInput,
): Promise<CoachClients.ScheduleOutcome> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) => service.schedule(credential, input)),
  )
}

export const removeCoachClient = async (
  credential: LaunchCredential,
  clientId: string,
): Promise<{ readonly deleted: boolean }> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) => service.remove(credential, clientId)),
  )
}

export const resetCoachClientInvite = async (
  credential: LaunchCredential,
  clientId: string,
): Promise<CoachClients.ClientDetail | undefined> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) => service.resetInvite(credential, clientId)),
  )
}

export const resendCoachClientInvite = async (
  credential: LaunchCredential,
  clientId: string,
): Promise<CoachClients.ResendOutcome> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) => service.resendInvite(credential, clientId)),
  )
}

/** The coach's day and their calendar (#61) — Today, the list, and one session. */
export const loadCoachToday = async (
  credential: LaunchCredential,
): Promise<CoachSessions.TodayView> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachSessions.Service, (service) => service.today(credential)),
  )
}

export const loadCoachUpcomingSessions = async (
  credential: LaunchCredential,
): Promise<CoachSessions.UpcomingSessions> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachSessions.Service, (service) => service.upcoming(credential)),
  )
}

export const loadCoachSessionDetail = async (
  credential: LaunchCredential,
  sessionId: string,
): Promise<CoachSessions.SessionDetail | undefined> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachSessions.Service, (service) => service.detail(credential, sessionId)),
  )
}

export const prepareCoachInviteCard = async (
  credential: LaunchCredential,
  clientId: string,
): Promise<CoachClients.PreparedInviteCard | undefined> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) =>
      service.prepareInviteCard(credential, clientId),
    ),
  )
}

export const saveCoachTimezone = async (
  credential: LaunchCredential,
  timezone: string,
): Promise<void> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) => service.saveTimezone(credential, timezone)),
  )
}

export const hideCoachMainMiniAppHint = async (credential: LaunchCredential): Promise<void> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) => service.hideMainMiniAppHint(credential)),
  )
}

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
