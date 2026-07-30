import { describe, expect, it } from "@effect/vitest"
import { Effect, Result } from "effect"
import { avatarKey } from "./avatar-key.ts"
import { AvatarStore, MaxAvatarBytes } from "./avatar-store.ts"

interface Written {
  readonly key: string
  readonly bytes: Uint8Array
  readonly contentType: string | undefined
}

interface BucketStub {
  readonly bucket: AvatarStore.Bucket
  readonly writes: Array<Written>
}

/** Records what was put, and can refuse the way R2 refuses: by throwing. */
const bucketStub = (refuse = false): BucketStub => {
  const writes: Array<Written> = []
  const bucket: AvatarStore.Bucket = {
    put: async (key, body, options) => {
      if (refuse) throw new Error("R2 is unavailable")
      writes.push({
        key,
        bytes: new Uint8Array(body),
        contentType: options?.httpMetadata?.contentType,
      })
      return undefined
    },
  }
  return { bucket, writes }
}

const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01])

const store = (input: AvatarStore.StoreInput, stub: BucketStub) =>
  Effect.flatMap(AvatarStore.Service, (service) => service.store(input)).pipe(
    Effect.provide(AvatarStore.layer(stub.bucket)),
  )

const coachPhoto: AvatarStore.StoreInput = {
  subject: "coach",
  subjectId: "ws_019f92510000700080000000",
  sourceId: "AQADBAADq6cxG4AB",
  contentType: "image/jpeg",
  body: PHOTO,
}

describe("AvatarStore.store", () => {
  it.effect("puts the bytes at the composed key, with the content type on the object", () =>
    Effect.gen(function* () {
      const stub = bucketStub()

      const key = yield* store(coachPhoto, stub)

      expect(key).toBe(avatarKey(coachPhoto))
      expect(stub.writes).toEqual([{ key, bytes: PHOTO, contentType: "image/jpeg" }])
    }),
  )

  it.effect("stores the bare content type, not whatever the wire said", () =>
    Effect.gen(function* () {
      const stub = bucketStub()

      yield* store({ ...coachPhoto, contentType: "image/jpeg; charset=binary" }, stub)

      expect(stub.writes[0]?.contentType).toBe("image/jpeg")
    }),
  )

  it.effect("refuses a content type an avatar may not be, before touching the bucket", () =>
    Effect.gen(function* () {
      const stub = bucketStub()

      const outcome = yield* Effect.result(store({ ...coachPhoto, contentType: "image/gif" }, stub))

      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) expect(outcome.failure.reason).toBe("unsupported-type")
      expect(stub.writes).toEqual([])
    }),
  )

  it.effect("refuses a body larger than an avatar has any business being", () =>
    Effect.gen(function* () {
      const stub = bucketStub()

      const outcome = yield* Effect.result(
        store({ ...coachPhoto, body: new Uint8Array(MaxAvatarBytes + 1) }, stub),
      )

      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) expect(outcome.failure.reason).toBe("too-large")
      expect(stub.writes).toEqual([])
    }),
  )

  it.effect("refuses an empty body — an avatar of nothing is a failed download", () =>
    Effect.gen(function* () {
      const stub = bucketStub()

      const outcome = yield* Effect.result(store({ ...coachPhoto, body: new Uint8Array() }, stub))

      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) expect(outcome.failure.reason).toBe("empty")
      expect(stub.writes).toEqual([])
    }),
  )

  it.effect("reports a bucket that refused, carrying the key and nothing else", () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.result(store(coachPhoto, bucketStub(true)))

      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(outcome.failure.reason).toBe("write-failed")
        expect(outcome.failure.key).toBe(avatarKey(coachPhoto))
      }
    }),
  )

  it.effect("refuses a subject it cannot compose a key for", () =>
    Effect.gen(function* () {
      const stub = bucketStub()

      const outcome = yield* Effect.result(store({ ...coachPhoto, sourceId: "" }, stub))

      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) expect(outcome.failure.reason).toBe("unnameable")
      expect(stub.writes).toEqual([])
    }),
  )
})

/**
 * The layer every consumer's suite runs on, so what it accepts and refuses is
 * this package's business rather than each caller's imitation of it.
 */
describe("AvatarStore.testLayer", () => {
  const stored = Effect.flatMap(AvatarStore.TestService, (test) => test.stored())

  it.effect("records what it accepted, key and content type included", () =>
    Effect.gen(function* () {
      const service = yield* AvatarStore.Service

      const key = yield* service.store(coachPhoto)

      expect(key).toBe(avatarKey(coachPhoto))
      expect(yield* stored).toEqual([{ key, bytes: PHOTO, contentType: "image/jpeg" }])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("refuses exactly what the live layer refuses, and records nothing then", () =>
    Effect.gen(function* () {
      const service = yield* AvatarStore.Service

      const tooLarge = yield* Effect.result(
        service.store({ ...coachPhoto, body: new Uint8Array(MaxAvatarBytes + 1) }),
      )
      const wrongType = yield* Effect.result(
        service.store({ ...coachPhoto, contentType: "image/gif" }),
      )

      expect(Result.isFailure(tooLarge)).toBe(true)
      expect(Result.isFailure(wrongType)).toBe(true)
      expect(yield* stored).toEqual([])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )
})

/**
 * No bucket bound — what `vite dev` runs on, since it is not workerd and has no
 * bindings to offer (#59).
 */
describe("the unwired layer", () => {
  it.effect("refuses rather than pretending the object landed", () =>
    Effect.gen(function* () {
      const service = yield* AvatarStore.Service

      const outcome = yield* Effect.result(service.store(coachPhoto))

      expect(Result.isFailure(outcome)).toBe(true)
      // A key handed back here would be written to a column and would name an
      // object that does not exist — a broken avatar on every surface, forever.
      if (Result.isFailure(outcome)) expect(outcome.failure.reason).toBe("write-failed")
    }).pipe(Effect.provide(AvatarStore.unwiredLayer)),
  )
})
