import { CoachInitData, CoachOnboardingToken } from "@praximo/auth"
import {
  AvatarRepo,
  ClientRepo,
  Database,
  MemberRepo,
  SessionRepo,
  WorkspaceRepo,
} from "@praximo/db"
import { EmailChannel, type SendBinding } from "@praximo/email"
import { AvatarReader } from "@praximo/storage"
import { BotRegistry } from "@praximo/telegram"
import { ConfigProvider, Layer, ManagedRuntime } from "effect"
import { CoachAvatars } from "./coach-avatars.ts"
import { CoachClients } from "./coach-clients.ts"
import { type CoachRunner, coachConveyor } from "./coach-operation.ts"
import { CoachSession } from "./coach-session.ts"
import { CoachSessions } from "./coach-sessions.ts"
import { CoachSurface } from "./coach-surface.ts"
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
  /**
   * The shared avatar bucket (#231), **optional on purpose** and for the same
   * reason as `EMAIL`: `vite dev` is not workerd and has no bindings to offer.
   *
   * Its absence does not fail open or pretend — `AvatarReader.unwiredLayer` answers
   * every avatar route with 404, and every disc falls back to the initials that are
   * the specified design anyway. So a local run is photoless rather than wrong,
   * which is exactly why this ticket's own verification is a live one.
   */
  readonly UPLOADS?: AvatarReader.ReadableBucket
}

const runtimeFromEnv = (env: Env) => {
  const repositories = Layer.mergeAll(
    WorkspaceRepo.layer,
    MemberRepo.layer,
    ClientRepo.layer,
    SessionRepo.layer,
    AvatarRepo.layer,
  ).pipe(Layer.provide(Database.layer))
  // No binding, no pretending — the same rule the email channel follows, one
  // severity down: an unserved avatar is a courtesy, and initials are the design.
  const avatars =
    env.UPLOADS === undefined ? AvatarReader.unwiredLayer : AvatarReader.layer(env.UPLOADS)
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
    avatars,
    repositories,
  )
  const app = Layer.mergeAll(
    CoachSurface.layer.pipe(Layer.provide(CoachSession.layer)),
    CoachClients.layer.pipe(Layer.provide(CoachSession.layer)),
    CoachSessions.layer.pipe(Layer.provide(CoachSession.layer)),
    CoachAvatars.layer.pipe(Layer.provide(CoachSession.layer)),
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
    ...(workerEnv.UPLOADS === undefined
      ? {}
      : { UPLOADS: workerEnv.UPLOADS as AvatarReader.ReadableBucket }),
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

/**
 * The one entry into this Worker's runtime, and the whole of it.
 *
 * It replaced 22 exported wrappers (#234) whose bodies were this line with a
 * service name pasted into it. Not one of them added a default, a retry, a log or
 * a narrowing — they only gave each operation a second and a third name on the
 * way down, and one of them arrived at the service under a different word than it
 * left the browser with.
 *
 * ADR 0002's "one runtime per Worker entrypoint" is what this preserves: the
 * mandate is one *runtime*, and it is `getRuntime` above — never one export per
 * operation.
 */
export const runCoach: CoachRunner = async (effect) => (await getRuntime()).runPromise(effect)

/**
 * The conveyor every coach server function is built by, bound to that runtime.
 *
 * The builder itself lives in `coach-operation.ts` and knows nothing about a
 * runtime; this is the one line that introduces them, and the only reason a
 * `.functions.ts` module imports this file at all.
 */
export const { operation: coachOperation, acknowledgement: coachAcknowledgement } =
  coachConveyor(runCoach)
