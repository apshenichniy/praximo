import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { avatarETag } from "./avatar-key.ts"
import { AvatarCacheControl, AvatarReader } from "./avatar-reader.ts"

const KEY = "avatars/client/cl_019f92510000700080000001/AQADBAADq6cxG4AB-1a2b3c.jpg"
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

const serve = (input: AvatarReader.ServeInput) =>
  Effect.flatMap(AvatarReader.Service, (reader) => reader.serve(input))

const reads = Effect.flatMap(AvatarReader.TestService, (test) => test.reads())

const held = AvatarReader.testLayer({ [KEY]: BYTES })

describe("AvatarReader.serve", () => {
  it.effect("hands back the bytes, typed from the key and tagged from it", () =>
    Effect.gen(function* () {
      const served = yield* serve({ key: KEY })

      expect(served.status).toBe(200)
      expect(served.body).toBe(BYTES)
      expect(served.headers["Content-Type"]).toBe("image/jpeg")
      expect(served.headers.ETag).toBe(avatarETag(KEY))
      expect(served.headers["X-Content-Type-Options"]).toBe("nosniff")
    }).pipe(Effect.provide(held)),
  )

  it.effect("keeps the response out of every cache but the one browser's", () =>
    Effect.gen(function* () {
      const served = yield* serve({ key: KEY })

      // `private` is the containment: a photograph of a named person, served
      // from a URL that identifies them, must not sit in a shared cache.
      expect(served.headers["Cache-Control"]).toBe(AvatarCacheControl)
      expect(served.headers["Cache-Control"]).toContain("private")
      // No `Vary`: the coach's credential changes every launch, so varying on it
      // would mean no browser ever reused an avatar.
      expect(served.headers.Vary).toBeUndefined()
    }).pipe(Effect.provide(held)),
  )

  it.effect("answers a matching validator without opening the bucket at all", () =>
    Effect.gen(function* () {
      // The claim the whole derivation exists for, and it is about a call that
      // must *not* happen — hence `reads`.
      const served = yield* serve({ key: KEY, ifNoneMatch: avatarETag(KEY) })

      expect(served.status).toBe(304)
      expect(served.body).toBeUndefined()
      expect(served.headers.ETag).toBe(avatarETag(KEY))
      expect(served.headers["Cache-Control"]).toBe(AvatarCacheControl)
      expect(yield* reads).toEqual([])
    }).pipe(Effect.provide(held)),
  )

  it.effect("serves the bytes when the validator is somebody else's photo", () =>
    Effect.gen(function* () {
      const served = yield* serve({ key: KEY, ifNoneMatch: avatarETag("avatars/coach/ws_1/x.jpg") })

      expect(served.status).toBe(200)
      expect(yield* reads).toEqual([KEY])
    }).pipe(Effect.provide(held)),
  )

  it.effect("has one answer for an entity with no avatar, and never asks the bucket", () =>
    Effect.gen(function* () {
      const served = yield* serve({ key: undefined })

      expect(served.status).toBe(404)
      expect(served.headers["Cache-Control"]).toBe("no-store")
      expect(yield* reads).toEqual([])
    }).pipe(Effect.provide(held)),
  )

  it.effect("gives the same answer for a column naming an object that is not there", () =>
    Effect.gen(function* () {
      // The two halves of a write came apart. The screen shows initials; the log
      // is where the difference is visible.
      const served = yield* serve({ key: "avatars/client/cl_gone/AQAD-0.jpg" })

      expect(served.status).toBe(404)
      expect(served.headers["Cache-Control"]).toBe("no-store")
    }).pipe(Effect.provide(held)),
  )

  it.effect("refuses a key stored under an extension no avatar may have", () =>
    Effect.gen(function* () {
      const served = yield* serve({ key: "avatars/client/cl_1/AQAD-0.gif" })

      expect(served.status).toBe(404)
      expect(yield* reads).toEqual([])
    }).pipe(Effect.provide(held)),
  )

  it.effect("says a bucket outage is temporary rather than saying there is no photo", () =>
    Effect.gen(function* () {
      const served = yield* serve({ key: KEY }).pipe(
        Effect.provide(
          AvatarReader.layer({
            get: () => Promise.reject(new Error("R2 is unavailable")),
          }),
        ),
      )

      expect(served.status).toBe(503)
      expect(served.headers["Cache-Control"]).toBe("no-store")
    }),
  )
})

describe("AvatarReader.unwiredLayer", () => {
  it.effect("answers every key with no photo, which is what local development is", () =>
    Effect.gen(function* () {
      const served = yield* serve({ key: KEY })

      expect(served.status).toBe(404)
      expect(served.body).toBeUndefined()
    }).pipe(Effect.provide(AvatarReader.unwiredLayer)),
  )
})
