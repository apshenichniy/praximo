import { Context, Effect, Layer, Result } from "effect"
import { avatarContentTypeForKey, avatarETag } from "./avatar-key.ts"

/**
 * Handing a stored avatar back out — the other half of the seam
 * {@link AvatarStore} opened, and the one place the caching contract is written
 * (#231).
 *
 * It is a service for the same reason the writer is, with the callers swapped:
 * the coach Mini App serves a client's photo authorised by a launch credential,
 * and the Acceptance Page serves the coach's authorised by an invitation token.
 * What they share is not the authorisation — that is precisely what differs — but
 * everything after it: the `ETag`, the `Cache-Control`, the content type, and the
 * answer for a key that names nothing. Two hand-written header sets are how one
 * of two routes ends up cacheable by a proxy.
 *
 * **Which avatar is never decided here.** A caller resolves the key on its own
 * terms — scoped to a workspace, or to a token — and hands over whatever its
 * statement said, `undefined` included. The authorisation stays in the Worker
 * that understands it; the HTTP stays here.
 */

/**
 * As much of a stored object as serving one needs.
 *
 * Declared here rather than imported from `@cloudflare/workers-types` for the
 * reason `AvatarStore.Bucket` gives, and `body` is `unknown` for a sharper one:
 * this package typechecks against `ES2022` with no DOM lib and no Workers types
 * (`avatar-key.ts` goes out of its way to need neither), so a `ReadableStream`
 * is not a name it can say. It does not need to — the bytes are handed to
 * whatever the Worker builds its response with, unread.
 */
export interface StoredObject {
  readonly body: unknown
}

export interface ReadableBucket {
  readonly get: (key: string) => Promise<StoredObject | null>
}

/**
 * What every avatar response says about caching, and why it says it.
 *
 * `private` keeps the object out of every shared cache — Cloudflare's included —
 * which is the whole of the containment: these are photographs of named people,
 * served from a URL that identifies them.
 *
 * `max-age=0, must-revalidate` then asks the browser to check every time, and the
 * check is cheap and exact: the route re-reads the key it needs anyway to
 * authorise, compares the digest, and answers `304` **without opening the
 * bucket**. A longer freshness window would save that one indexed read and buy a
 * stale photo after a re-import, which is the wrong trade for an image of
 * somebody's face.
 *
 * **No `Vary`.** The coach's route authorises on a launch-credential header that
 * changes with every launch, so varying on it would mean no browser ever reused a
 * cached avatar. `private` is what makes that safe: nothing between the Worker and
 * that browser may hold the response at all.
 */
export const AvatarCacheControl = "private, max-age=0, must-revalidate"

/** What a refusal says instead — there is nothing here worth remembering. */
const NoStore = "no-store"

/**
 * A response, as a package with no DOM lib can describe one.
 *
 * The Worker turns this into a real `Response` in one line. That split is what
 * lets the status and the headers — the part with rules — live here once, while
 * the construction stays in the runtime that has the constructor.
 */
export interface ServedAvatar {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  /** The object's bytes, absent for every status that carries none. */
  readonly body?: unknown
}

export interface ServeInput {
  /**
   * The object to serve, or `undefined` when the entity has no avatar — the
   * ordinary case for most people, answered the same way as a key that names
   * nothing so no caller writes the difference twice.
   */
  readonly key: string | undefined
  /** The request's `If-None-Match`, verbatim; `null` is what a header reader returns. */
  readonly ifNoneMatch?: string | null
}

export interface Interface {
  /**
   * The response, always — there is no failure channel, because every way this
   * can go wrong is a status an `<img>` falls back to initials on.
   */
  readonly serve: (input: ServeInput) => Effect.Effect<ServedAvatar>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/storage/AvatarReader",
) {}

const refusal = (status: number): ServedAvatar => ({
  status,
  headers: { "Cache-Control": NoStore },
})

/** No avatar, whatever the reason. The one answer a caller never has to branch on. */
const Missing = refusal(404)

/**
 * The operation over whichever bucket it was handed, shared by the live layer and
 * the test one so the caching rules are asserted against rather than faked.
 */
const serveFrom = (bucket: ReadableBucket): Interface["serve"] =>
  Effect.fn("AvatarReader.serve")(function* (input: ServeInput) {
    const key = input.key
    if (key === undefined) return Missing

    const contentType = avatarContentTypeForKey(key)
    if (contentType === undefined) {
      // Unreachable for a key this package composed, and a refusal rather than a
      // guess: `application/octet-stream` on an avatar route is a download
      // prompt, and letting a browser sniff it is worse.
      yield* Effect.logWarning(`avatar ${key} is stored under no extension an avatar may have`)
      return Missing
    }

    const etag = avatarETag(key)
    // Before the bucket, which is the point of deriving the tag from the key at
    // all: a repeat view costs the indexed read the route already made, and
    // nothing else.
    if (input.ifNoneMatch === etag) {
      return { status: 304, headers: { ETag: etag, "Cache-Control": AvatarCacheControl } }
    }

    const object = yield* Effect.result(
      Effect.tryPromise({ try: () => bucket.get(key), catch: () => "bucket" as const }),
    )
    if (Result.isFailure(object)) {
      yield* Effect.logWarning(`avatar ${key}: the bucket did not answer`)
      return refusal(503)
    }
    if (object.success === null) {
      // A row naming an object that is not there — the one shape that means the
      // two halves of a write came apart. Worth a line; the person looking at the
      // screen sees initials rather than anything broken.
      yield* Effect.logWarning(`avatar ${key}: the column names an object the bucket does not hold`)
      return Missing
    }

    return {
      status: 200,
      headers: {
        "Content-Type": contentType,
        ETag: etag,
        "Cache-Control": AvatarCacheControl,
        // These bytes came from Telegram or from Google, and the type above is
        // derived from a key rather than measured. Sniffing is exactly what must
        // not happen to them.
        "X-Content-Type-Options": "nosniff",
      },
      body: object.success.body,
    }
  })

export const layer = (bucket: ReadableBucket): Layer.Layer<Service> =>
  Layer.succeed(Service, Service.of({ serve: serveFrom(bucket) }))

/**
 * No bucket bound, and it says so rather than pretending.
 *
 * `vite dev` is not workerd and has no bindings to offer, so this is what the two
 * web Workers run on locally: every avatar route answers 404 and every disc falls
 * back to the initials that are the specified design anyway. `EmailChannel`'s
 * unwired layer is the same idea one severity up — an unsent invitation deserves
 * a typed error, an unserved avatar is a courtesy.
 */
export const unwiredLayer: Layer.Layer<Service> = Layer.succeed(
  Service,
  Service.of({
    serve: Effect.fn("AvatarReader.serve")(function* (input: ServeInput) {
      if (input.key !== undefined) {
        yield* Effect.logDebug(`avatar ${input.key} not served: no bucket is bound`)
      }
      return Missing
    }),
  }),
)

export interface TestInterface extends Interface {
  /** Every key the bucket was asked for, in order — `[]` is what a 304 costs. */
  readonly reads: () => Effect.Effect<ReadonlyArray<string>>
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@praximo/storage/AvatarReader/Test",
) {}

/**
 * Reads from memory, and answers exactly what the live layer answers — because it
 * *is* the live operation over a bucket that recites instead of fetching.
 *
 * A hand-rolled double in each consumer would answer for none of the rules this
 * package exists to hold while every consumer's suite went on passing (ADR 0002:
 * packages export `layer` and `testLayer`). `reads` is here because "a repeat view
 * does not re-read R2" is a claim about a call that must *not* happen, and only
 * the double can witness that.
 */
export const testLayer = (objects: Readonly<Record<string, Uint8Array>> = {}) =>
  Layer.effectContext(
    Effect.sync(() => {
      const reads: Array<string> = []
      const bucket: ReadableBucket = {
        get: async (key) => {
          reads.push(key)
          const bytes = objects[key]
          // The bytes themselves stand in for R2's stream: `body` is opaque to
          // this package, and a `Uint8Array` is something a real `Response` would
          // accept just as readily — so a consumer asserting on it is asserting on
          // what would actually be sent.
          return bytes === undefined ? null : { body: bytes }
        },
      }
      const impl = TestService.of({
        serve: serveFrom(bucket),
        reads: () => Effect.sync(() => [...reads]),
      })
      return Context.make(Service, impl).pipe(Context.add(TestService, impl))
    }),
  )

export * as AvatarReader from "./avatar-reader.ts"
