import { AvatarRepo, ClientAcceptanceRepo, Database } from "@praximo/db"
import { AvatarReader, AvatarStore } from "@praximo/storage"
import { ConfigProvider, type Effect, Layer, ManagedRuntime } from "effect"

import { GoogleIdentity } from "./google-identity.ts"
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
   * The shared avatar bucket, **read since #231 and written since #59**, optional
   * for the same reason the limits are: absent, the two unwired layers answer
   * every avatar route with 404 and refuse every write, and the page renders the
   * initials that are the specified design anyway. So a local run is not *wrong*,
   * it is only photoless — which is exactly why both tickets' verification is a
   * live one.
   *
   * One binding, two narrow interfaces over it. An R2 binding carries no scope of
   * its own, so what keeps this Worker to reading a coach's photo and writing a
   * client's is that it holds `get` and `put` and nothing else.
   */
  readonly UPLOADS?: AvatarReader.ReadableBucket & AvatarStore.Bucket
  /**
   * The Google profile import (#59), optional in the same spirit and read through
   * the `ConfigProvider` below rather than off this record: `GoogleIdentity` owns
   * what an empty one means, which is a page that renders finished with no button
   * on it. They are listed here so a local `vite dev` forwards them — nothing
   * reaches the provider that this record does not carry.
   */
  readonly GOOGLE_CLIENT_ID?: string
  readonly GOOGLE_CLIENT_SECRET?: string
  readonly GOOGLE_REDIRECT_ORIGINS?: string
}

/**
 * The Google keys as they arrive from either source, absent when unset.
 *
 * Empty is the same as missing here — an operator who left `GOOGLE_CLIENT_ID=` in
 * place of deleting the line means the same thing by it, and `GoogleIdentity`
 * treats both as "no OAuth client on this stage".
 */
const googleEnv = (source: Record<string, unknown>): Partial<Env> => {
  const read = (name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REDIRECT_ORIGINS") => {
    const value = source[name]
    return typeof value === "string" && value.length > 0 ? { [name]: value } : {}
  }
  return {
    ...read("GOOGLE_CLIENT_ID"),
    ...read("GOOGLE_CLIENT_SECRET"),
    ...read("GOOGLE_REDIRECT_ORIGINS"),
  }
}

const runtimeFromEnv = (env: Env) => {
  const uploads = env.UPLOADS
  // The transport is the Worker's own, and it is the same one the imported
  // picture is fetched with — there is one in this runtime, and naming it twice
  // is how a proxy ends up on one path and not the other.
  const google = GoogleIdentity.layer(globalThis.fetch)
  const acceptance = WebAcceptance.layer(globalThis.fetch).pipe(
    Layer.provide(ClientAcceptanceRepo.layer),
    Layer.provide(AvatarRepo.layer),
    Layer.provide(Database.layer),
    Layer.provide(google),
    Layer.provide(uploads === undefined ? AvatarReader.unwiredLayer : AvatarReader.layer(uploads)),
    Layer.provide(uploads === undefined ? AvatarStore.unwiredLayer : AvatarStore.layer(uploads)),
  )
  // Merged rather than only provided: the two `/auth/google/*` routes reach the
  // Google contour directly, with no page and no invitation lookup between them,
  // so it has to be in the runtime's own context and not merely inside the
  // Acceptance Page's. The shared `google` value is what keeps that one instance.
  const app = Layer.merge(acceptance, google)
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

/** Both halves checked, because this Worker now uses both (#231 reads, #59 writes). */
const asUploads = (
  value: unknown,
): (AvatarReader.ReadableBucket & AvatarStore.Bucket) | undefined =>
  typeof value === "object" && value !== null && "get" in value && "put" in value
    ? (value as AvatarReader.ReadableBucket & AvatarStore.Bucket)
    : undefined

const resolveEnv = async (): Promise<Env> => {
  // The same two-source shape the coach Worker uses: `process.env` under Vite,
  // the Worker's own bindings otherwise. Keyed on the one binding that is
  // required either way, so a half-configured local run fails at boot with the
  // name of what is missing rather than on the first query.
  if (typeof process !== "undefined" && import.meta.env.DEV && process.env.DATABASE_URL) {
    return {
      DATABASE_URL: requireString(process.env.DATABASE_URL, "DATABASE_URL"),
      // Forwarded so the import is developable locally: `vite dev` reads the root
      // `.env`, and `http://localhost:3003` is one of the origins registered with
      // Google for exactly this reason.
      ...googleEnv(process.env),
    }
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
    ...googleEnv(workerEnv),
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
 *
 * Two services rather than one since #59: the Acceptance Page's own, and the
 * Google contour the two `/auth/google/*` routes reach directly without a page
 * or an invitation lookup between them.
 */
export const runAcceptance = async <A, E>(
  effect: Effect.Effect<A, E, WebAcceptance.Service | GoogleIdentity.Service>,
): Promise<A> => (await getRuntime()).runPromise(effect)
