import { Context, Effect, Layer, Schema } from "effect"
import { avatarContentType, type AvatarSubject, avatarKey } from "./avatar-key.ts"

/**
 * Putting an avatar in R2 — the one write path every avatar in the product goes
 * through (#225).
 *
 * It exists as a service in a package rather than as a few lines inside
 * provisioning because there are two callers with nothing else in common: the
 * bot Worker snapshotting a coach's Telegram profile photo, and the client
 * Worker snapshotting a Google `picture` on the Acceptance Page (#59). What they
 * share is the key layout, the content types an avatar may be, and the size an
 * avatar may not exceed — so those live here, once, and neither Worker gets to
 * invent its own.
 *
 * **Where the bytes come from is deliberately not this package's business.** It
 * takes bytes and a name for their source; Telegram's three-call dance and
 * Google's URL fetch stay with the Workers that know about Telegram and Google.
 */

/**
 * The R2 bucket, structurally, and only the one method this package calls.
 *
 * Declared here rather than imported from `@cloudflare/workers-types` for the
 * same reason `@praximo/email` declares its `SendBinding`: a package should not
 * depend on the runtime it happens to deploy to, and a three-line interface is a
 * test double anybody can write. `apps/pipeline`'s `ObjectCleanup` narrows the
 * same binding to `{ delete }` for the same reason.
 */
export interface Bucket {
  readonly put: (
    key: string,
    body: Uint8Array,
    options?: { readonly httpMetadata?: { readonly contentType?: string } },
  ) => Promise<unknown>
}

/**
 * The most an avatar may weigh. Generous by two orders of magnitude — a Telegram
 * profile photo is tens of kilobytes — because the number is not a compression
 * target but a refusal to stream something unbounded into the bucket on the word
 * of a remote server.
 */
export const MaxAvatarBytes = 5 * 1024 * 1024

/**
 * Why an avatar was not stored.
 *
 * One error with a `reason` rather than four, the way `TokenIngestionFailed`
 * discriminates its own refusals: every caller of this treats the whole set the
 * same way — log it, keep the picture it already had — and only the log cares
 * which. The payload carries the key where there is one and never the bytes, the
 * source URL, or the cause.
 */
export class AvatarRejected extends Schema.TaggedErrorClass<AvatarRejected>()(
  "AvatarStore.Rejected",
  {
    reason: Schema.Literals([
      "unsupported-type",
      "unnameable",
      "empty",
      "too-large",
      "write-failed",
    ]),
    key: Schema.optionalKey(Schema.String),
  },
) {}

export interface StoreInput {
  readonly subject: AvatarSubject
  /** The row this picture hangs off — a workspace for a coach, a client for a client. */
  readonly subjectId: string
  /** A stable name for the source picture; see {@link avatarKey}. */
  readonly sourceId: string
  readonly contentType: string
  readonly body: Uint8Array
}

export interface Interface {
  /**
   * Store one avatar and hand back its key — the value a caller writes to the
   * column, and the value a later refresh compares against.
   */
  readonly store: (input: StoreInput) => Effect.Effect<string, AvatarRejected>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/storage/AvatarStore",
) {}

/**
 * The operation itself, over whichever bucket it was handed — shared by the live
 * layer and the test one, so the rules are asserted against rather than faked.
 */
const storeInto = (bucket: Bucket): Interface["store"] =>
  Effect.fn("AvatarStore.store")(function* (input: StoreInput) {
    // Resolved before the key so the refusal names the actual problem: an
    // unusable content type and an unusable subject both leave `avatarKey`
    // with nothing to return. The normalised type is what goes on the object,
    // so it comes back from the same call rather than being re-derived.
    const resolved = avatarContentType(input.contentType)
    if (resolved === undefined) {
      return yield* new AvatarRejected({ reason: "unsupported-type" })
    }
    const contentType = resolved.type
    const key = avatarKey({
      subject: input.subject,
      subjectId: input.subjectId,
      sourceId: input.sourceId,
      contentType,
    })
    if (key === undefined) return yield* new AvatarRejected({ reason: "unnameable" })
    // An avatar of nothing is a download that failed without saying so, and
    // storing it would put the column in front of a broken image instead of
    // the initials that are the specified fallback everywhere.
    if (input.body.byteLength === 0) {
      return yield* new AvatarRejected({ reason: "empty", key })
    }
    if (input.body.byteLength > MaxAvatarBytes) {
      return yield* new AvatarRejected({ reason: "too-large", key })
    }
    yield* Effect.tryPromise({
      try: () => bucket.put(key, input.body, { httpMetadata: { contentType } }),
      catch: () => new AvatarRejected({ reason: "write-failed", key }),
    })
    return key
  })

export const layer = (bucket: Bucket): Layer.Layer<Service> =>
  Layer.succeed(Service, Service.of({ store: storeInto(bucket) }))

/** One object as the test layer recorded it, exactly as it was put. */
export interface StoredAvatar {
  readonly key: string
  readonly bytes: Uint8Array
  readonly contentType: string | undefined
}

export interface TestInterface extends Interface {
  /** Every object stored, in order. */
  readonly stored: () => Effect.Effect<ReadonlyArray<StoredAvatar>>
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@praximo/storage/AvatarStore/Test",
) {}

/**
 * Stores into memory, and refuses exactly what the live layer refuses — because
 * it *is* the live operation, over a bucket that records instead of writing.
 *
 * The validation is deliberately not stubbed: the key layout, the content types an
 * avatar may be, and the size it may not exceed are this package's whole contract,
 * and a fake of `store` would answer for none of them while every consumer's suite
 * went on passing. Which is also why it lives here rather than as a hand-rolled
 * recording bucket in each consumer (ADR 0002: packages export `layer` and
 * `testLayer`).
 */
export const testLayer = Layer.effectContext(
  Effect.sync(() => {
    const objects: Array<StoredAvatar> = []
    const recorder: Bucket = {
      put: async (key, body, options) => {
        objects.push({ key, bytes: body, contentType: options?.httpMetadata?.contentType })
        return undefined
      },
    }
    const impl = TestService.of({
      store: storeInto(recorder),
      stored: () => Effect.sync(() => [...objects]),
    })
    return Context.make(Service, impl).pipe(Context.add(TestService, impl))
  }),
)

export * as AvatarStore from "./avatar-store.ts"
