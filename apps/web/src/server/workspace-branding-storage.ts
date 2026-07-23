import { createHash } from "node:crypto"
import { Config, Context, Effect, Layer, Ref, Schema } from "effect"
import { decode } from "jpeg-js"

const MaxNormalizedAvatarBytes = 10 * 1_024 * 1_024
const NormalizedAvatarDimension = 512

export interface StoredAvatar {
  readonly key: string
  readonly digest: string
}

export interface Interface {
  readonly inspectAvatar: (
    bytes: Uint8Array,
  ) => Effect.Effect<{ readonly digest: string }, InvalidAvatar>
  readonly putAvatar: (
    requestId: string,
    bytes: Uint8Array,
  ) => Effect.Effect<StoredAvatar, InvalidAvatar | UploadFailed>
  readonly putInspectedAvatar: (
    requestId: string,
    bytes: Uint8Array,
    inspection: { readonly digest: string },
  ) => Effect.Effect<StoredAvatar, UploadFailed>
  readonly deleteAvatar: (key: string) => Effect.Effect<void, UploadFailed>
  readonly resolveAvatarKey: (customKey: string | undefined) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/web/WorkspaceBrandingStorage",
) {}

export class InvalidAvatar extends Schema.TaggedErrorClass<InvalidAvatar>()(
  "WorkspaceBrandingStorage.InvalidAvatar",
  { reason: Schema.Literals(["type", "size"]) },
) {}

export class UploadFailed extends Schema.TaggedErrorClass<UploadFailed>()(
  "WorkspaceBrandingStorage.UploadFailed",
  { operation: Schema.Literals(["put", "delete"]) },
) {}

export interface Bucket {
  readonly put: (
    key: string,
    value: Uint8Array,
    options?: { readonly httpMetadata?: { readonly contentType?: string } },
  ) => Promise<unknown>
  readonly delete: (key: string) => Promise<unknown>
}

const validateJpeg = (bytes: Uint8Array): Effect.Effect<void, InvalidAvatar> => {
  if (bytes.byteLength === 0 || bytes.byteLength > MaxNormalizedAvatarBytes) {
    return Effect.fail(new InvalidAvatar({ reason: "size" }))
  }
  try {
    const decoded = decode(bytes, {
      useTArray: true,
      tolerantDecoding: false,
      maxResolutionInMP: 1,
      maxMemoryUsageInMB: 20,
    })
    if (
      decoded.width !== NormalizedAvatarDimension ||
      decoded.height !== NormalizedAvatarDimension
    ) {
      return Effect.fail(new InvalidAvatar({ reason: "type" }))
    }
  } catch {
    return Effect.fail(new InvalidAvatar({ reason: "type" }))
  }
  return Effect.void
}

const make = (bucket: Bucket, defaultAvatarKey: string): Interface => {
  const inspectAvatar = Effect.fn("WorkspaceBrandingStorage.inspectAvatar")(function* (
    bytes: Uint8Array,
  ) {
    yield* validateJpeg(bytes)
    return { digest: createHash("sha256").update(bytes).digest("hex") }
  })

  const putInspectedAvatar = Effect.fn("WorkspaceBrandingStorage.putInspectedAvatar")(function* (
    requestId: string,
    bytes: Uint8Array,
    inspection: { readonly digest: string },
  ) {
    const key = `workspace-branding/${requestId}/${inspection.digest}.jpg`
    yield* Effect.tryPromise({
      try: () => bucket.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } }),
      catch: () => new UploadFailed({ operation: "put" }),
    })
    return { key, digest: inspection.digest }
  })

  const putAvatar = Effect.fn("WorkspaceBrandingStorage.putAvatar")(function* (
    requestId: string,
    bytes: Uint8Array,
  ) {
    const inspection = yield* inspectAvatar(bytes)
    return yield* putInspectedAvatar(requestId, bytes, inspection)
  })

  const deleteAvatar = Effect.fn("WorkspaceBrandingStorage.deleteAvatar")(function* (key: string) {
    yield* Effect.tryPromise({
      try: () => bucket.delete(key),
      catch: () => new UploadFailed({ operation: "delete" }),
    })
  })

  const resolveAvatarKey = Effect.fn("WorkspaceBrandingStorage.resolveAvatarKey")(
    (customKey: string | undefined) => Effect.succeed(customKey ?? defaultAvatarKey),
  )

  return Service.of({
    inspectAvatar,
    putAvatar,
    putInspectedAvatar,
    deleteAvatar,
    resolveAvatarKey,
  })
}

export const layer = (bucket: Bucket) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const defaultAvatarKey = yield* Config.nonEmptyString("DEFAULT_COACH_BOT_AVATAR_R2_KEY")
      return make(bucket, defaultAvatarKey)
    }),
  )

export interface RecordedPut {
  readonly key: string
  readonly bytes: Uint8Array
}

export interface TestInterface extends Interface {
  readonly puts: () => Effect.Effect<ReadonlyArray<RecordedPut>>
  readonly deletes: () => Effect.Effect<ReadonlyArray<string>>
  readonly failNextPut: () => Effect.Effect<void>
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@praximo/web/WorkspaceBrandingStorage/Test",
) {}

export const testLayer = ({ defaultAvatarKey }: { readonly defaultAvatarKey: string }) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const recorded = yield* Ref.make<ReadonlyArray<RecordedPut>>([])
      const deleted = yield* Ref.make<ReadonlyArray<string>>([])
      const fail = yield* Ref.make(false)
      const bucket: Bucket = {
        put: async (key, bytes) => {
          if (await Effect.runPromise(Ref.getAndSet(fail, false))) throw new Error("put failed")
          await Effect.runPromise(Ref.update(recorded, (puts) => [...puts, { key, bytes }]))
        },
        delete: async (key) => {
          await Effect.runPromise(Ref.update(deleted, (keys) => [...keys, key]))
        },
      }
      const base = make(bucket, defaultAvatarKey)
      const impl = TestService.of({
        ...base,
        puts: Effect.fn("WorkspaceBrandingStorage.Test.puts")(() => Ref.get(recorded)),
        deletes: Effect.fn("WorkspaceBrandingStorage.Test.deletes")(() => Ref.get(deleted)),
        failNextPut: Effect.fn("WorkspaceBrandingStorage.Test.failNextPut")(() =>
          Ref.set(fail, true),
        ),
      })
      return Context.make(Service, impl).pipe(Context.add(TestService, impl))
    }),
  )

export * as WorkspaceBrandingStorage from "./workspace-branding-storage.ts"
