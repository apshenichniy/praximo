import { describe, expect, it } from "@effect/vitest"
import { AvatarRepo, QueryFailed } from "@praximo/db"
import { TelegramId, WorkspaceId } from "@praximo/domain"
import { AvatarStore, avatarKey, MaxAvatarBytes } from "@praximo/storage"
import { Effect, Fiber, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import {
  type AvatarRepoStub,
  CLIENT_PHOTO,
  clientAvatarRepoStub,
  type PhotoFixture,
  type PhotoRouteOptions,
  telegramPhotoRoutes,
} from "./__tests__/telegram-photo.ts"
import { captureClientPhoto } from "./client-photo.ts"
import { ImportTimeoutMillis } from "./telegram-photo.ts"

/**
 * The client's photo, captured at the moment they accept (#231).
 *
 * The two properties that matter most here are about what must *not* happen: this
 * runs after the commit that carries the consent, so no branch of it may raise or
 * write anything the client did not agree to — and a client with no photo, which is
 * most of them, must cost nothing and read as ordinary.
 */

const workspaceId = WorkspaceId.make("ws_019f92510000700080000000")
const clientId = "cl_019f92510000700080000042"
const client = TelegramId.make("810000123")
/** The coach's own bot — the one the client `/start`ed, so the only one that sees them. */
const COACH_BOT_TOKEN = "9100777:coach-bot-token"

interface TelegramStub {
  readonly fetch: typeof globalThis.fetch
  /** Every request path, so "no download happened" is provable. */
  readonly requests: Array<string>
  /** Every credential a request carried, so the caller can be identified. */
  readonly tokens: Array<string>
}

const telegramStub = (
  photo: PhotoFixture | "none",
  options: PhotoRouteOptions = {},
): TelegramStub => {
  const routes = telegramPhotoRoutes(photo, options)
  const requests: Array<string> = []
  const tokens: Array<string> = []
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = input.toString()
    const { pathname } = new URL(url)
    requests.push(pathname)
    tokens.push(/\/(?:file\/)?bot([^/]+)\//.exec(pathname)?.[1] ?? "")
    return routes(url) ?? Response.json({ ok: true, result: true })
  }
  return { fetch, requests, tokens }
}

const capture = (telegram: TelegramStub, repo: AvatarRepoStub) =>
  captureClientPhoto({
    workspaceId,
    clientId,
    clientTelegramId: client,
    coachBotToken: COACH_BOT_TOKEN,
    fetch: telegram.fetch,
  }).pipe(Effect.provide(repo.layer))

/** What the store accepted, in order. */
const stored = Effect.flatMap(AvatarStore.TestService, (store) => store.stored())

/** A method no test here reaches; a double that answered would let that pass. */
const unreachable = () => Effect.die(new Error("must not be reached"))

const keyFor = (photo: PhotoFixture): string | undefined =>
  avatarKey({
    subject: "client",
    subjectId: clientId,
    sourceId: photo.fileUniqueId,
    contentType: "image/jpeg",
  })

describe("capturing the client's Telegram photo", () => {
  it.effect("files it under the client and writes the key to their row", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(CLIENT_PHOTO)
      const repo = clientAvatarRepoStub()

      const outcome = yield* capture(telegram, repo)

      expect(outcome).toBe("stored")
      expect(yield* stored).toEqual([
        { key: keyFor(CLIENT_PHOTO), bytes: CLIENT_PHOTO.bytes, contentType: "image/jpeg" },
      ])
      // Under the *client*, not the workspace: the picture hangs off the person.
      expect(keyFor(CLIENT_PHOTO)?.startsWith(`avatars/client/${clientId}/`)).toBe(true)
      expect(repo.key()).toBe(keyFor(CLIENT_PHOTO))
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("asks through the coach's own bot, the one the client messaged", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(CLIENT_PHOTO)

      yield* capture(telegram, clientAvatarRepoStub())

      // Including the download: `file_id` and `file_path` are scoped to the bot
      // that obtained them, so all three calls have to be the same credential —
      // and it is never the manager bot, which the client has no chat with.
      expect(new Set(telegram.tokens)).toEqual(new Set([COACH_BOT_TOKEN]))
      expect(telegram.requests.at(-1)).toBe(`/file/bot${COACH_BOT_TOKEN}/${CLIENT_PHOTO.filePath}`)
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("leaves a client with no photo exactly as they were", () =>
    Effect.gen(function* () {
      const telegram = telegramStub("none")
      const repo = clientAvatarRepoStub()

      const outcome = yield* capture(telegram, repo)

      // The ordinary case for most people, and not a fault: `total_count: 0` is
      // what Telegram answers both for no photo and for one hidden from bots.
      expect(outcome).toBe("absent")
      expect(repo.writes).toEqual([])
      expect(repo.key()).toBeUndefined()
      expect(yield* stored).toEqual([])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("never clears a key on an empty answer, because nothing asks again", () =>
    Effect.gen(function* () {
      const telegram = telegramStub("none")
      const repo = clientAvatarRepoStub(keyFor(CLIENT_PHOTO))

      const outcome = yield* capture(telegram, repo)

      // The coach's refresh *withdraws* a photo on a definite empty answer (#225).
      // A client's capture must not: there is no per-client sweep, so this branch
      // can only be reached by a redelivered acceptance — where dropping the photo
      // we hold would be losing it for no reason at all.
      expect(outcome).toBe("absent")
      expect(repo.writes).toEqual([])
      expect(repo.key()).toBe(keyFor(CLIENT_PHOTO))
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("spends one call and no bytes when the photo is already held", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(CLIENT_PHOTO)
      const repo = clientAvatarRepoStub(keyFor(CLIENT_PHOTO))

      const outcome = yield* capture(telegram, repo)

      // What makes a redelivered `ca:` callback harmless: no `getFile`, no
      // download, no put, and no second write.
      expect(outcome).toBe("unchanged")
      expect(telegram.requests).toEqual([`/bot${COACH_BOT_TOKEN}/getUserProfilePhotos`])
      expect(yield* stored).toEqual([])
      expect(repo.writes).toEqual([])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("writes nothing when Telegram does not answer at all", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(CLIENT_PHOTO, { refuse: "getUserProfilePhotos" })
      const repo = clientAvatarRepoStub()

      const outcome = yield* capture(telegram, repo)

      expect(outcome).toBe("failed")
      expect(repo.writes).toEqual([])
      expect(yield* stored).toEqual([])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("refuses a photo too large to be an avatar before requesting it", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(CLIENT_PHOTO, { fileSize: MaxAvatarBytes + 1 })
      const repo = clientAvatarRepoStub()

      const outcome = yield* capture(telegram, repo)

      expect(outcome).toBe("skipped")
      // Refused on Telegram's own reported size, so the bytes never travel.
      expect(telegram.requests.some((path) => path.startsWith("/file/"))).toBe(false)
      expect(yield* stored).toEqual([])
      expect(repo.key()).toBeUndefined()
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("gives up rather than holding the webhook open on a hung download", () =>
    Effect.gen(function* () {
      const routes = telegramPhotoRoutes(CLIENT_PHOTO)
      const requests: Array<string> = []
      // A file endpoint that accepted the connection and then stopped answering.
      // `fetch` has no timeout of its own, so without the import's own bound this
      // never resolves — Telegram redelivers the acceptance, and the redelivery
      // replaces the client's confirmation with "you are already set up".
      const hanging: typeof globalThis.fetch = async (input) => {
        const url = input.toString()
        const { pathname } = new URL(url)
        requests.push(pathname)
        if (pathname.startsWith("/file/bot")) return new Promise<Response>(() => {})
        return routes(url) ?? Response.json({ ok: true, result: true })
      }
      const repo = clientAvatarRepoStub()

      // Forked and driven by the test clock rather than waited out: the assertion is
      // that the bound exists and fires, not that ten real seconds pass.
      const running = yield* Effect.forkChild(
        captureClientPhoto({
          workspaceId,
          clientId,
          clientTelegramId: client,
          coachBotToken: COACH_BOT_TOKEN,
          fetch: hanging,
        }).pipe(Effect.provide(repo.layer)),
      )
      yield* TestClock.adjust(ImportTimeoutMillis)
      const outcome = yield* Fiber.join(running)

      expect(outcome).toBe("failed")
      expect(requests.some((path) => path.startsWith("/file/"))).toBe(true)
      expect(repo.writes).toEqual([])
      expect(yield* stored).toEqual([])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("stores nothing when the row cannot even be read", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(CLIENT_PHOTO)
      const unreadable = Layer.succeed(
        AvatarRepo.Service,
        AvatarRepo.Service.of({
          clientAvatarKey: () =>
            Effect.fail(
              new QueryFailed({ operation: "AvatarRepo.clientAvatarKey", cause: "down" }),
            ),
          setClientAvatar: unreachable,
          coachAvatarKey: unreachable,
          setCoachAvatar: unreachable,
          coachAvatarKeyForInvite: unreachable,
        }),
      )

      const outcome = yield* captureClientPhoto({
        workspaceId,
        clientId,
        clientTelegramId: client,
        coachBotToken: COACH_BOT_TOKEN,
        fetch: telegram.fetch,
      }).pipe(Effect.provide(unreadable))

      expect(outcome).toBe("failed")
      expect(yield* stored).toEqual([])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("reports a failure when the object lands but no row in this workspace holds it", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(CLIENT_PHOTO)
      // What the statement answers for a client id outside the workspace that
      // asked. Reporting "stored" would put a key in a log that no row carries.
      const elsewhere = Layer.succeed(
        AvatarRepo.Service,
        AvatarRepo.Service.of({
          clientAvatarKey: () => Effect.succeed(undefined),
          setClientAvatar: () => Effect.succeed({ outcome: "no-row" }),
          coachAvatarKey: unreachable,
          setCoachAvatar: unreachable,
          coachAvatarKeyForInvite: unreachable,
        }),
      )

      const outcome = yield* captureClientPhoto({
        workspaceId,
        clientId,
        clientTelegramId: client,
        coachBotToken: COACH_BOT_TOKEN,
        fetch: telegram.fetch,
      }).pipe(Effect.provide(elsewhere))

      expect(outcome).toBe("failed")
      expect(yield* stored).toHaveLength(1)
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )
})
