import { describe, expect, it } from "@effect/vitest"
import { AvatarRepo, QueryFailed } from "@praximo/db"
import { WorkspaceId } from "@praximo/domain"
import { AvatarStore, avatarKey, MaxAvatarBytes } from "@praximo/storage"
import { Effect, Fiber, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"

import { captureGooglePicture, PictureTimeoutMillis } from "./google-picture.ts"

/**
 * The Google picture, snapshotted at the moment the client accepts (#59).
 *
 * Everything worth pinning here is about what must *not* happen. This runs after
 * the commit that carries the consent, on a request the client is watching for
 * their confirmation — so no branch of it may raise, none may write an object the
 * client did not agree to, and a picture from anywhere but Google must never
 * become a request this Worker makes.
 */

const workspaceId = WorkspaceId.make("ws_019f92510000700080000000")
const clientId = "cl_019f92510000700080000042"
const PICTURE = "https://lh3.googleusercontent.com/a/ACg8ocK=s256-c"
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

const unreached = () => Effect.die(new Error("must not be reached"))

interface RepoStub {
  readonly layer: Layer.Layer<AvatarRepo.Service>
  readonly key: () => string | undefined
  readonly writes: () => number
}

const repoStub = (outcome: AvatarRepo.AvatarWriteOutcome | "throws" = "written"): RepoStub => {
  let key: string | undefined
  let writes = 0
  return {
    layer: Layer.succeed(
      AvatarRepo.Service,
      AvatarRepo.Service.of({
        clientAvatarKey: unreached,
        setClientAvatar: (input) =>
          Effect.gen(function* () {
            writes += 1
            if (outcome === "throws") {
              return yield* Effect.fail(
                new QueryFailed({
                  operation: "AvatarRepo.setClientAvatar",
                  cause: new Error("database unavailable"),
                }),
              )
            }
            if (outcome === "written") key = input.r2Key
            return { outcome }
          }),
        coachAvatarKey: unreached,
        setCoachAvatar: unreached,
        coachAvatarKeyForInvite: unreached,
      }),
    ),
    key: () => key,
    writes: () => writes,
  }
}

interface Transport {
  readonly fetch: typeof globalThis.fetch
  readonly requests: Array<string>
}

const transport = (answer: () => Response | Promise<Response>): Transport => {
  const requests: Array<string> = []
  const fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input))
    return await answer()
  }) as typeof globalThis.fetch
  return { fetch, requests }
}

const image = (
  bytes: Uint8Array = BYTES,
  contentType = "image/jpeg",
  headers: Readonly<Record<string, string>> = {},
) =>
  new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { "content-type": contentType, ...headers },
  })

const capture = (pictureUrl: string | undefined, net: Transport, repo: RepoStub) =>
  captureGooglePicture({ workspaceId, clientId, pictureUrl, fetch: net.fetch }).pipe(
    Effect.provide(repo.layer),
  )

const stored = Effect.flatMap(AvatarStore.TestService, (store) => store.stored())

const keyFor = (sourceId: string) =>
  avatarKey({ subject: "client", subjectId: clientId, sourceId, contentType: "image/jpeg" })

describe("snapshotting the imported picture", () => {
  it.effect("files it under the client and writes the key to their row", () =>
    Effect.gen(function* () {
      const net = transport(() => image())
      const repo = repoStub()

      const outcome = yield* capture(PICTURE, net, repo)

      expect(outcome).toBe("stored")
      expect(yield* stored).toEqual([
        { key: keyFor(PICTURE), bytes: BYTES, contentType: "image/jpeg" },
      ])
      // Under the *client*: the picture hangs off the person, as the bot's does.
      expect(keyFor(PICTURE)?.startsWith(`avatars/client/${clientId}/`)).toBe(true)
      expect(repo.key()).toBe(keyFor(PICTURE))
      expect(net.requests).toEqual([PICTURE])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  /** Most clients arrive without one, and it is the ordinary answer, not a fault. */
  it.effect("does nothing at all when Google offered no picture", () =>
    Effect.gen(function* () {
      const net = transport(() => image())
      const repo = repoStub()

      expect(yield* capture(undefined, net, repo)).toBe("absent")
      expect(yield* stored).toEqual([])
      expect(net.requests).toEqual([])
      expect(repo.writes()).toBe(0)
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  /**
   * The guard that matters most in this file: the URL is sealed into a cookie the
   * page cannot write, and it is checked again here anyway. A server-side fetch to
   * an address somebody else chose is the one thing this must never become.
   */
  it.effect("refuses an address that is not Google's, without asking for it", () =>
    Effect.gen(function* () {
      const net = transport(() => image())
      const repo = repoStub()

      expect(yield* capture("http://169.254.169.254/latest/meta-data/", net, repo)).toBe("rejected")
      expect(net.requests).toEqual([])
      expect(yield* stored).toEqual([])
      expect(repo.writes()).toBe(0)
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("keeps the client's initials when the picture does not download", () =>
    Effect.gen(function* () {
      const repo = repoStub()
      const outcome = yield* capture(
        PICTURE,
        transport(() => new Response("gone", { status: 404 })),
        repo,
      )

      expect(outcome).toBe("failed")
      expect(yield* stored).toEqual([])
      expect(repo.writes()).toBe(0)
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("gives up on a transport that raises rather than answers", () =>
    Effect.gen(function* () {
      const repo = repoStub()
      const outcome = yield* capture(
        PICTURE,
        transport(() => Promise.reject(new Error("connection reset"))),
        repo,
      )

      expect(outcome).toBe("failed")
      expect(repo.writes()).toBe(0)
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("refuses a body Google served under a type an avatar may not be", () =>
    Effect.gen(function* () {
      const repo = repoStub()
      const outcome = yield* capture(
        PICTURE,
        transport(() => image(BYTES, "image/svg+xml")),
        repo,
      )

      expect(outcome).toBe("rejected")
      expect(yield* stored).toEqual([])
      expect(repo.writes()).toBe(0)
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  /** Refused on the reported size, before the body is ever held in memory. */
  it.effect("refuses an oversized picture on the length it declares", () =>
    Effect.gen(function* () {
      const repo = repoStub()
      const outcome = yield* capture(
        PICTURE,
        transport(() =>
          image(BYTES, "image/jpeg", { "content-length": String(MaxAvatarBytes + 1) }),
        ),
        repo,
      )

      expect(outcome).toBe("rejected")
      expect(yield* stored).toEqual([])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("refuses an oversized picture that declared nothing", () =>
    Effect.gen(function* () {
      const repo = repoStub()
      const outcome = yield* capture(
        PICTURE,
        transport(() => image(new Uint8Array(MaxAvatarBytes + 1))),
        repo,
      )

      expect(outcome).toBe("rejected")
      expect(repo.writes()).toBe(0)
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("says so when the object landed but the row kept its own key", () =>
    Effect.gen(function* () {
      const repo = repoStub("no-row")
      const outcome = yield* capture(
        PICTURE,
        transport(() => image()),
        repo,
      )

      // The object is in the bucket and no row names it, so "stored" would put a
      // key in the log that nothing carries.
      expect(outcome).toBe("failed")
      expect((yield* stored).length).toBe(1)
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("survives a repository that will not answer", () =>
    Effect.gen(function* () {
      const outcome = yield* capture(
        PICTURE,
        transport(() => image()),
        repoStub("throws"),
      )

      expect(outcome).toBe("failed")
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  /**
   * A defect, not a failure — there is no failure channel here by construction.
   * The client has already been committed and is watching for their confirmation,
   * so a raised value must not become the error they see instead of it.
   */
  it.effect("survives a repository that raises outright", () =>
    Effect.gen(function* () {
      const outcome = yield* capture(
        PICTURE,
        transport(() => image()),
        {
          layer: Layer.succeed(
            AvatarRepo.Service,
            AvatarRepo.Service.of({
              clientAvatarKey: unreached,
              setClientAvatar: unreached,
              coachAvatarKey: unreached,
              setCoachAvatar: unreached,
              coachAvatarKeyForInvite: unreached,
            }),
          ),
          key: () => undefined,
          writes: () => 0,
        },
      )

      expect(outcome).toBe("failed")
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  /**
   * The bound is not a performance budget, it is the reason a client's
   * confirmation cannot be held open by a picture endpoint that stopped
   * answering.
   */
  it.effect("gives up on a download that never finishes", () =>
    Effect.gen(function* () {
      const repo = repoStub()
      const net = transport(() => new Promise<Response>(() => {}))

      // Forked and driven by the test clock rather than waited out: the assertion
      // is that the bound exists and fires, not that five real seconds pass.
      const running = yield* Effect.forkChild(capture(PICTURE, net, repo))
      yield* TestClock.adjust(PictureTimeoutMillis)
      const outcome = yield* Fiber.join(running)

      expect(outcome).toBe("failed")
      expect(net.requests).toEqual([PICTURE])
      expect(repo.writes()).toBe(0)
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )
})
