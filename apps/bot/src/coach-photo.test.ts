import { describe, expect, it } from "@effect/vitest"
import { AvatarRepo, QueryFailed } from "@praximo/db"
import { TelegramId, WorkspaceId } from "@praximo/domain"
import { AvatarStore, avatarKey, MaxAvatarBytes } from "@praximo/storage"
import { ConfigProvider, Effect, Layer } from "effect"
import {
  type AvatarRepoStub,
  avatarRepoStub,
  CHANGED_PHOTO,
  COACH_PHOTO,
  type PhotoFixture,
  type PhotoRouteOptions,
  telegramPhotoRoutes,
} from "./__tests__/coach-photo.ts"
import { BRANDING_AVATAR_KEY, uploadsStub } from "./__tests__/uploads.ts"
import { CoachBotProvisioningRuntime } from "./coach-bot-provisioning-runtime.ts"
import { refreshCoachPhoto } from "./coach-photo.ts"

/**
 * The coach's photo, from Telegram into R2 and onto the member row (#225).
 *
 * Two properties carry the whole design and each has its own test below: an
 * unchanged photo costs one API call and no bytes, and nothing on this path may
 * ever raise — every branch resolves to an outcome the caller only logs.
 */

const workspaceId = WorkspaceId.make("ws_019f92510000700080000000")
const coach = TelegramId.make("800000101")
const MANAGER_TOKEN = "manager-token"

const env = {
  MANAGER_BOT_TOKEN: MANAGER_TOKEN,
  MANAGER_BOT_USERNAME: "PraximoManagerBot",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: BRANDING_AVATAR_KEY,
  COACH_MINI_APP_URL: "https://coach.praximo.io/",
  CLIENT_APP_URL: "https://me.praximo.io",
  UPLOADS: uploadsStub().bucket,
}

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

/**
 * The refresh, with everything but the store provided: `AvatarStore.testLayer`
 * comes from the suite so a test can read back what it accepted.
 */
const refresh = (telegram: TelegramStub, repo: AvatarRepoStub) =>
  refreshCoachPhoto({ workspaceId, coachTelegramId: coach }).pipe(
    Effect.provide(CoachBotProvisioningRuntime.testLayer(env.UPLOADS, telegram.fetch)),
    Effect.provide(repo.layer),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
  )

/** What the store accepted, in order. */
const stored = Effect.flatMap(AvatarStore.TestService, (store) => store.stored())

const keyFor = (photo: PhotoFixture): string | undefined =>
  avatarKey({
    subject: "coach",
    subjectId: workspaceId,
    sourceId: photo.fileUniqueId,
    contentType: "image/jpeg",
  })

describe("importing the coach's Telegram photo", () => {
  it.effect("stores the largest size and writes its key to the member row", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(COACH_PHOTO)
      const repo = avatarRepoStub()

      const outcome = yield* refresh(telegram, repo)

      expect(outcome).toBe("stored")
      expect(yield* stored).toEqual([
        { key: keyFor(COACH_PHOTO), bytes: COACH_PHOTO.bytes, contentType: "image/jpeg" },
      ])
      expect(repo.key()).toBe(keyFor(COACH_PHOTO))
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("asks Telegram as the manager bot, the one bot that can see the coach", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(COACH_PHOTO)

      yield* refresh(telegram, avatarRepoStub())

      // Including the download: `file_id` and `file_path` are scoped to the bot
      // that obtained them, so all three calls have to be the same credential.
      expect(new Set(telegram.tokens)).toEqual(new Set([MANAGER_TOKEN]))
      expect(telegram.requests.at(-1)).toBe(`/file/bot${MANAGER_TOKEN}/${COACH_PHOTO.filePath}`)
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("spends one call and no bytes when the photo is the one already held", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(COACH_PHOTO)
      const repo = avatarRepoStub(keyFor(COACH_PHOTO))

      const outcome = yield* refresh(telegram, repo)

      expect(outcome).toBe("unchanged")
      // The property the whole key design exists for: no `getFile`, no download,
      // no put, and no write — which is what makes the daily sweep affordable.
      expect(telegram.requests).toEqual([`/bot${MANAGER_TOKEN}/getUserProfilePhotos`])
      expect(yield* stored).toEqual([])
      expect(repo.writes).toEqual([])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("replaces a photo that changed, and hands the old key to the repository", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(CHANGED_PHOTO)
      const repo = avatarRepoStub(keyFor(COACH_PHOTO))

      const outcome = yield* refresh(telegram, repo)

      expect(outcome).toBe("stored")
      expect((yield* stored).map((object) => object.key)).toEqual([keyFor(CHANGED_PHOTO)])
      // The write is what queues the superseded object for deletion; this only
      // has to hand it the new key.
      expect(repo.writes).toEqual([keyFor(CHANGED_PHOTO)])
      expect(repo.key()).toBe(keyFor(CHANGED_PHOTO))
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("leaves a coach with no photo exactly as they were", () =>
    Effect.gen(function* () {
      const telegram = telegramStub("none")
      const repo = avatarRepoStub()

      const outcome = yield* refresh(telegram, repo)

      expect(outcome).toBe("absent")
      expect(repo.writes).toEqual([])
      expect(repo.key()).toBeUndefined()
      expect(yield* stored).toEqual([])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("drops the stored key when the coach withdraws their photo", () =>
    Effect.gen(function* () {
      const telegram = telegramStub("none")
      const repo = avatarRepoStub(keyFor(COACH_PHOTO))

      const outcome = yield* refresh(telegram, repo)

      // Removed or hidden from bots — indistinguishable from here, and both are
      // the coach withdrawing it. Initials take over.
      expect(outcome).toBe("cleared")
      expect(repo.writes).toEqual([undefined])
      expect(repo.key()).toBeUndefined()
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("changes nothing when Telegram does not answer at all", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(COACH_PHOTO, { refuse: "getUserProfilePhotos" })
      const repo = avatarRepoStub(keyFor(COACH_PHOTO))

      const outcome = yield* refresh(telegram, repo)

      // A call that failed is not evidence the coach withdrew anything, so the
      // key they had survives — the opposite of the definite empty answer above.
      expect(outcome).toBe("failed")
      expect(repo.writes).toEqual([])
      expect(repo.key()).toBe(keyFor(COACH_PHOTO))
      expect(yield* stored).toEqual([])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("keeps the photo it holds when the file cannot be resolved", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(CHANGED_PHOTO, { refuse: "getFile" })
      const repo = avatarRepoStub(keyFor(COACH_PHOTO))

      expect(yield* refresh(telegram, repo)).toBe("failed")
      expect(repo.key()).toBe(keyFor(COACH_PHOTO))
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("keeps the photo it holds when Telegram names no path for the file", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(CHANGED_PHOTO, { withoutFilePath: true })
      const repo = avatarRepoStub()

      expect(yield* refresh(telegram, repo)).toBe("failed")
      expect(telegram.requests.some((path) => path.startsWith("/file/"))).toBe(false)
      expect(repo.key()).toBeUndefined()
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("keeps the photo it holds when the download itself fails", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(CHANGED_PHOTO, { refuse: "download" })
      const repo = avatarRepoStub()

      expect(yield* refresh(telegram, repo)).toBe("failed")
      expect(yield* stored).toEqual([])
      expect(repo.key()).toBeUndefined()
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("refuses a photo too large to be an avatar before requesting it", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(COACH_PHOTO, { fileSize: MaxAvatarBytes + 1 })
      const repo = avatarRepoStub()

      const outcome = yield* refresh(telegram, repo)

      expect(outcome).toBe("skipped")
      // Refused on Telegram's own reported size, so the bytes never travel.
      expect(telegram.requests.some((path) => path.startsWith("/file/"))).toBe(false)
      expect(yield* stored).toEqual([])
      expect(repo.key()).toBeUndefined()
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("reports a failure rather than success when the row cannot be read", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(COACH_PHOTO)
      // A database that cannot answer says nothing about the coach's photo, so
      // nothing is stored on the strength of it — least of all a key no row holds.
      const unreadable = Layer.succeed(
        AvatarRepo.Service,
        AvatarRepo.Service.of({
          coachAvatarKey: () =>
            Effect.fail(new QueryFailed({ operation: "AvatarRepo.coachAvatarKey", cause: "down" })),
          setCoachAvatar: () => Effect.die(new Error("must not be reached")),
        }),
      )

      const outcome = yield* refreshCoachPhoto({ workspaceId, coachTelegramId: coach }).pipe(
        Effect.provide(CoachBotProvisioningRuntime.testLayer(env.UPLOADS, telegram.fetch)),
        Effect.provide(unreadable),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
      )

      expect(outcome).toBe("failed")
      expect(yield* stored).toEqual([])
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )

  it.effect("reports a failure when the object lands but no owner member holds it", () =>
    Effect.gen(function* () {
      const telegram = telegramStub(COACH_PHOTO)
      // What the statement answers for a workspace with no owner row: nothing was
      // written. Reporting "stored" here would put a key in a log that no row has.
      const ownerless = Layer.succeed(
        AvatarRepo.Service,
        AvatarRepo.Service.of({
          coachAvatarKey: () => Effect.succeed(undefined),
          setCoachAvatar: () => Effect.succeed({ outcome: "no-owner" }),
        }),
      )

      const outcome = yield* refreshCoachPhoto({ workspaceId, coachTelegramId: coach }).pipe(
        Effect.provide(CoachBotProvisioningRuntime.testLayer(env.UPLOADS, telegram.fetch)),
        Effect.provide(ownerless),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
      )

      expect(outcome).toBe("failed")
      expect(yield* stored).toHaveLength(1)
    }).pipe(Effect.provide(AvatarStore.testLayer)),
  )
})
