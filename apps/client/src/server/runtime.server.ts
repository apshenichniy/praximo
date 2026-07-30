import { AvatarRepo, ClientAcceptanceRepo, Database } from "@praximo/db"
import { AvatarReader } from "@praximo/storage"
import { ConfigProvider, type Effect, Layer, ManagedRuntime } from "effect"

import type { Limiter } from "./throttle.ts"
import { WebAcceptance } from "./web-acceptance.ts"

/**
 * This Worker's first Effect runtime, and its first database (#57).
 *
 * Until now `apps/client` served two legal texts and `/health`: constants and a
 * status code, no state anywhere. The Acceptance Page is the first route here
 * that reads a row, so this file is where the app stops being a static site with
 * a router.
 *
 * Deliberately thinner than the coach's equivalent. There is no credential to
 * verify — nobody is signed in, which is the whole premise of the surface — no
 * Telegram runtime, and no bot binding. Two repositories, one bucket, one
 * connection.
 */

interface Env {
  readonly DATABASE_URL: string
  /**
   * The two rate limits, **optional on purpose**.
   *
   * `vite dev` is not workerd and has no bindings to offer, so a required one
   * would make the page undevelopable locally. `throttle` fails open when they
   * are absent — see the reasoning there, and note that what they buy is a route
   * that is not a free database query, never protection against token guessing.
   */
  readonly INVITE_LOOKUP?: Limiter
  readonly INVITE_COMMIT?: Limiter
  /**
   * The shared avatar bucket (#231), optional for the same reason the limits are
   * and with a different consequence: absent, `AvatarReader.unwiredLayer` answers
   * every avatar route with 404 and the Acceptance Page renders the initials that
   * are the specified design anyway. So a local run is not *wrong*, it is only
   * photoless — which is exactly why the ticket's own verification is a live one.
   */
  readonly UPLOADS?: AvatarReader.ReadableBucket
}

const runtimeFromEnv = (env: Env) => {
  const app = WebAcceptance.layer.pipe(
    Layer.provide(ClientAcceptanceRepo.layer),
    Layer.provide(AvatarRepo.layer),
    Layer.provide(Database.layer),
    Layer.provide(
      env.UPLOADS === undefined ? AvatarReader.unwiredLayer : AvatarReader.layer(env.UPLOADS),
    ),
  )
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

const asLimiter = (value: unknown): Limiter | undefined =>
  typeof value === "object" && value !== null && "limit" in value ? (value as Limiter) : undefined

const asUploads = (value: unknown): AvatarReader.ReadableBucket | undefined =>
  typeof value === "object" && value !== null && "get" in value
    ? (value as AvatarReader.ReadableBucket)
    : undefined

const resolveEnv = async (): Promise<Env> => {
  // The same two-source shape the coach Worker uses: `process.env` under Vite,
  // the Worker's own bindings otherwise. Keyed on the one binding that is
  // required either way, so a half-configured local run fails at boot with the
  // name of what is missing rather than on the first query.
  if (typeof process !== "undefined" && import.meta.env.DEV && process.env.DATABASE_URL) {
    return { DATABASE_URL: requireString(process.env.DATABASE_URL, "DATABASE_URL") }
  }

  const { env } = await import("cloudflare:workers")
  const workerEnv = env as unknown as Record<string, unknown>
  const lookup = asLimiter(workerEnv.INVITE_LOOKUP)
  const commit = asLimiter(workerEnv.INVITE_COMMIT)
  const uploads = asUploads(workerEnv.UPLOADS)
  return {
    DATABASE_URL: requireString(workerEnv.DATABASE_URL, "DATABASE_URL"),
    ...(lookup === undefined ? {} : { INVITE_LOOKUP: lookup }),
    ...(commit === undefined ? {} : { INVITE_COMMIT: commit }),
    ...(uploads === undefined ? {} : { UPLOADS: uploads }),
  }
}

let runtimePromise: Promise<ReturnType<typeof runtimeFromEnv>> | undefined
let envPromise: Promise<Env> | undefined

const getEnv = () => (envPromise ??= resolveEnv())
const getRuntime = () => (runtimePromise ??= getEnv().then(runtimeFromEnv))

/** The limiters, for the server functions that count a request before running it. */
export const inviteLimiters = async (): Promise<{
  readonly lookup: Limiter | undefined
  readonly commit: Limiter | undefined
}> => {
  const env = await getEnv()
  return { lookup: env.INVITE_LOOKUP, commit: env.INVITE_COMMIT }
}

/**
 * The one entry into this Worker's runtime, and the whole of it — the coach
 * tree's `runCoach` under this app's name (#234). Two wrappers stood here and
 * neither added anything to the line below it.
 */
export const runAcceptance = async <A, E>(
  effect: Effect.Effect<A, E, WebAcceptance.Service>,
): Promise<A> => (await getRuntime()).runPromise(effect)
