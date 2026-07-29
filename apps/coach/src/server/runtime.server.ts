import { CoachInitData, CoachOnboardingToken } from "@praximo/auth"
import { ClientRepo, Database, MemberRepo, SessionRepo, WorkspaceRepo } from "@praximo/db"
import type { WorkingHours } from "@praximo/domain"
import { EmailChannel, type SendBinding } from "@praximo/email"
import { BotRegistry } from "@praximo/telegram"
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"
import { CoachClients } from "./coach-clients.ts"
import { CoachSession } from "./coach-session.ts"
import { CoachSessions } from "./coach-sessions.ts"
import { CoachSurface } from "./coach-surface.ts"
import type { LaunchCredential } from "./launch-credential.ts"
import { canUseLocalProcessEnvironment } from "./runtime-environment.ts"

/**
 * Everything this Worker asks of the bot Worker across the one binding they
 * share: manager-bot delivery, coach-bot release, and — since #179 — a card
 * authored by a coach's own bot. Named once, because a binding that grows a
 * capability must grow it in exactly one place.
 */
type BotWorkerBinding = BotRegistry.RpcClient

interface Env {
  readonly DATABASE_URL: string
  readonly MANAGER_BOT_USERNAME: string
  /** Selects Telegram's Ed25519 public key for the coach path (ADR 0006). */
  readonly TELEGRAM_ENV: string
  /**
   * The client app's own origin — `me.praximo.io`. Bound from
   * that Worker's `.url` in `alchemy.run.ts` rather than written into `.env`, so
   * it cannot name a host the stack did not actually deploy.
   *
   * Required, not optional: the legal texts live there now, and a coach who
   * cannot reach the terms cannot accept them. A stage missing it is
   * misconfigured, and that is worth failing at boot over.
   */
  readonly CLIENT_APP_URL: string
  /**
   * Local development only: the public half of the throwaway pair the dev
   * credential minter signs with. Absent everywhere else, and the branch that
   * populates it folds out of a production build.
   */
  readonly COACH_DEV_PUBLIC_KEY?: string
  readonly MANAGER_BOT?: BotWorkerBinding
  /**
   * The `send_email` binding (#58), **optional on purpose** for the same reason
   * the client Worker's rate limits are: `vite dev` is not workerd and has no
   * bindings to offer, so a required one would make the coach app
   * undevelopable locally.
   *
   * Unlike a rate limit, its absence does not fail open. `EmailChannel`'s
   * unwired layer refuses every send with a typed error, so a local coach meets
   * the same failure path a deployed one would — never a screen claiming to have
   * sent something that never existed.
   */
  readonly EMAIL?: SendBinding
}

const runtimeFromEnv = (env: Env) => {
  const repositories = Layer.mergeAll(
    WorkspaceRepo.layer,
    MemberRepo.layer,
    ClientRepo.layer,
    SessionRepo.layer,
  ).pipe(Layer.provide(Database.layer))
  const coachBots =
    env.MANAGER_BOT === undefined ? BotRegistry.layer : BotRegistry.rpcLayer(env.MANAGER_BOT)
  // Config *selects* Telegram's trust anchor from two keys already in source;
  // development anchors on the throwaway key it also signs with. Either way the
  // real verifier runs — a wrong public key can only make verification fail.
  const coachInitData =
    env.COACH_DEV_PUBLIC_KEY === undefined
      ? CoachInitData.layer
      : CoachInitData.testLayer(env.COACH_DEV_PUBLIC_KEY)
  // No binding, no pretending: the unwired layer refuses the send with a typed
  // error rather than logging it and answering success (#58).
  const email = env.EMAIL === undefined ? EmailChannel.unwiredLayer : EmailChannel.layer(env.EMAIL)
  const dependencies = Layer.mergeAll(
    coachInitData,
    CoachOnboardingToken.layer,
    coachBots,
    email,
    repositories,
  )
  const app = Layer.mergeAll(
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
      MANAGER_BOT_USERNAME: requireString(process.env.MANAGER_BOT_USERNAME, "MANAGER_BOT_USERNAME"),
      TELEGRAM_ENV: requireString(process.env.TELEGRAM_ENV, "TELEGRAM_ENV"),
      CLIENT_APP_URL: requireString(process.env.CLIENT_APP_URL, "CLIENT_APP_URL"),
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
    MANAGER_BOT_USERNAME: requireString(workerEnv.MANAGER_BOT_USERNAME, "MANAGER_BOT_USERNAME"),
    TELEGRAM_ENV: requireString(workerEnv.TELEGRAM_ENV, "TELEGRAM_ENV"),
    CLIENT_APP_URL: requireString(workerEnv.CLIENT_APP_URL, "CLIENT_APP_URL"),
    ...(workerEnv.MANAGER_BOT === undefined
      ? {}
      : { MANAGER_BOT: workerEnv.MANAGER_BOT as BotWorkerBinding }),
    ...(workerEnv.EMAIL === undefined ? {} : { EMAIL: workerEnv.EMAIL as SendBinding }),
  }
}

/**
 * The client app's origin, for the two callers that need it without needing the
 * whole Effect runtime — the `/legal/*` redirects. Resolved through the same
 * `resolveEnv` as everything else, so local development and a deployed Worker
 * read it from the same place.
 */
export const clientAppUrl = async (): Promise<string> => (await resolveEnv()).CLIENT_APP_URL

let runtimePromise: Promise<ReturnType<typeof runtimeFromEnv>> | undefined

const getRuntime = () => (runtimePromise ??= resolveEnv().then(runtimeFromEnv))

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

export const recordCoachInviteDelivery = async (
  credential: LaunchCredential,
  clientId: string,
  kind: unknown,
): Promise<{ readonly recorded: boolean }> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) =>
      service.recordDelivery(credential, clientId, kind),
    ),
  )
}

/** The invitation the service sends itself (#58) — the only email this Worker sends. */
export const sendCoachInviteEmail = async (
  credential: LaunchCredential,
  clientId: string,
  address: unknown,
): Promise<CoachClients.SendInviteEmailOutcome> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) =>
      service.sendInviteEmail(credential, clientId, address),
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

export const loadCoachWorkingHours = async (
  credential: LaunchCredential,
): Promise<WorkingHours> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) => service.workingHours(credential)),
  )
}

export const saveCoachWorkingHours = async (
  credential: LaunchCredential,
  input: unknown,
): Promise<{ readonly saved: boolean }> => {
  const appRuntime = await getRuntime()
  return appRuntime.runPromise(
    Effect.flatMap(CoachClients.Service, (service) => service.saveWorkingHours(credential, input)),
  )
}
