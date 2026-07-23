import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { encode } from "jpeg-js"
import { WorkspaceBrandingStorage } from "./workspace-branding-storage.ts"

const jpeg = new Uint8Array(
  encode({ width: 512, height: 512, data: new Uint8Array(512 * 512 * 4).fill(255) }, 50).data,
)

describe("WorkspaceBrandingStorage", () => {
  it.effect(
    "stores custom avatars under isolated content-addressed keys and resolves the default",
    () =>
      Effect.gen(function* () {
        const storage = yield* WorkspaceBrandingStorage.Service
        const first = yield* storage.putAvatar("cb6bd559-6091-4d69-aeff-2af000354c7f", jpeg)
        const second = yield* storage.putAvatar("cb6bd559-6091-4d69-aeff-2af000354c7f", jpeg)
        const test = yield* WorkspaceBrandingStorage.TestService

        expect(first).toEqual(second)
        expect(first.key).toMatch(
          /^workspace-branding\/cb6bd559-6091-4d69-aeff-2af000354c7f\/[a-f0-9]{64}\.jpg$/,
        )
        expect(yield* storage.resolveAvatarKey(undefined)).toBe("branding/default-coach-avatar.jpg")
        expect(yield* storage.resolveAvatarKey(first.key)).toBe(first.key)
        expect(yield* storage.getAvatar(first.key)).toEqual({
          bytes: jpeg,
          contentType: "image/jpeg",
        })
        expect((yield* test.puts()).map((put) => put.key)).toEqual([first.key, second.key])
      }).pipe(
        Effect.provide(
          WorkspaceBrandingStorage.testLayer({
            defaultAvatarKey: "branding/default-coach-avatar.jpg",
          }),
        ),
      ),
  )

  it.effect("reports missing and failed private avatar reads", () =>
    Effect.gen(function* () {
      const storage = yield* WorkspaceBrandingStorage.Service
      const missing = yield* Effect.flip(storage.getAvatar("workspace-branding/missing.jpg"))
      expect(missing).toMatchObject({
        _tag: "WorkspaceBrandingStorage.ReadFailed",
        reason: "not-found",
      })

      const test = yield* WorkspaceBrandingStorage.TestService
      yield* test.failNextGet()
      const failed = yield* Effect.flip(storage.getAvatar("workspace-branding/missing.jpg"))
      expect(failed).toMatchObject({
        _tag: "WorkspaceBrandingStorage.ReadFailed",
        reason: "read",
      })
    }).pipe(
      Effect.provide(
        WorkspaceBrandingStorage.testLayer({
          defaultAvatarKey: "branding/default-coach-avatar.jpg",
        }),
      ),
    ),
  )

  it.effect("rejects non-JPEG bytes and can surface an upload failure", () =>
    Effect.gen(function* () {
      const storage = yield* WorkspaceBrandingStorage.Service
      yield* Effect.flip(
        storage.putAvatar("cb6bd559-6091-4d69-aeff-2af000354c7f", new Uint8Array([1, 2, 3])),
      )
      const test = yield* WorkspaceBrandingStorage.TestService
      yield* test.failNextPut()
      yield* Effect.flip(storage.putAvatar("cb6bd559-6091-4d69-aeff-2af000354c7f", jpeg))
      expect(yield* test.puts()).toEqual([])
    }).pipe(
      Effect.provide(
        WorkspaceBrandingStorage.testLayer({
          defaultAvatarKey: "branding/default-coach-avatar.jpg",
        }),
      ),
    ),
  )

  it.effect("uses content-addressed keys and rejects a JPEG with wrong dimensions", () =>
    Effect.gen(function* () {
      const storage = yield* WorkspaceBrandingStorage.Service
      const changed = new Uint8Array(
        encode({ width: 512, height: 512, data: new Uint8Array(512 * 512 * 4).fill(127) }, 50).data,
      )
      const first = yield* storage.putAvatar("cb6bd559-6091-4d69-aeff-2af000354c7f", jpeg)
      const second = yield* storage.putAvatar("cb6bd559-6091-4d69-aeff-2af000354c7f", changed)
      expect(second.key).not.toBe(first.key)

      const wrongDimensions = new Uint8Array(
        encode({ width: 256, height: 512, data: new Uint8Array(256 * 512 * 4).fill(255) }, 50).data,
      )
      const error = yield* Effect.flip(
        storage.putAvatar("cb6bd559-6091-4d69-aeff-2af000354c7f", wrongDimensions),
      )
      expect(error._tag).toBe("WorkspaceBrandingStorage.InvalidAvatar")
    }).pipe(
      Effect.provide(
        WorkspaceBrandingStorage.testLayer({
          defaultAvatarKey: "branding/default-coach-avatar.jpg",
        }),
      ),
    ),
  )
})
