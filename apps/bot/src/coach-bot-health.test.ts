import { describe, expect, it } from "@effect/vitest"
import { CoachBotHealthRepo, CoachBotProvisioningRepo } from "@praximo/db"
import { CoachLanguage, TelegramId, WorkspaceId } from "@praximo/domain"
import { AvatarStore, avatarKey } from "@praximo/storage"
import { BotRegistry, CoachBotCredential } from "@praximo/telegram"
import { GrammyError, HttpError } from "grammy"
import { Clock, ConfigProvider, Effect, Layer } from "effect"
import {
  unusedAvatarRepo,
  unusedAvatarStore,
  unusedClientAcceptanceRepo,
  unusedManagerSender,
  unusedRegistry,
} from "./__tests__/coach-bot-provisioning.ts"
import {
  type AvatarRepoStub,
  avatarRepoStub,
  CHANGED_PHOTO,
  COACH_PHOTO,
  type PhotoFixture,
  telegramPhotoRoutes,
} from "./__tests__/telegram-photo.ts"
import { CoachBotProvisioningRuntime } from "./coach-bot-provisioning-runtime.ts"
import { CoachBotProvisioning } from "./coach-bot-provisioning.ts"
import {
  checkCoachBot,
  classifyCoachBotFailure,
  classifyManagementFailure,
  HEALTH_CHECK_INTERVAL_MILLIS,
  HEALTH_RETRY_INTERVAL_MILLIS,
  webhookOriginFrom,
} from "./coach-bot-health.ts"
import { BRANDING_AVATAR_BYTES, BRANDING_AVATAR_KEY, uploadsStub } from "./__tests__/uploads.ts"
import * as BotRegistryLive from "./bot-registry.ts"

/**
 * The repair-before-report fence (#55).
 *
 * Everything here turns on one live finding: a coach's `/revoke` leaves our
 * stored token answering 401 while the manager's *management* rights survive, so
 * `getManagedBotToken` still hands back a working credential. The workspace
 * therefore never leaves `connected` for the ordinary case, and only a bot that
 * is genuinely gone — or one we never managed — reaches the flip.
 */

const workspaceId = WorkspaceId.make("ws_019f92510000700080000000")
const coach = TelegramId.make("800000101")
const BOT_ID = "9100010"
const BOT_USERNAME = "ada_coach_bot"
const STALE_TOKEN = `${BOT_ID}:AAHstaleAAHstaleAAHstaleAAHstaleAAH`
const FRESH_TOKEN = `${BOT_ID}:AAHfreshAAHfreshAAHfreshAAHfreshAAH`

const env = {
  MANAGER_BOT_TOKEN: "manager-token",
  MANAGER_BOT_USERNAME: "PraximoManagerBot",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: BRANDING_AVATAR_KEY,
  COACH_MINI_APP_URL: "https://coach.praximo.io/",
  CLIENT_APP_URL: "https://me.praximo.io",
  MANAGER_BOT_WEBHOOK_URL: "https://bot.praximo.test/telegram/manager",
  UPLOADS: uploadsStub({ [BRANDING_AVATAR_KEY]: BRANDING_AVATAR_BYTES }).bucket,
}

const unsupported = () => Effect.die(new Error("unsupported test operation"))

const target = (
  overrides: Partial<CoachBotHealthRepo.HealthTarget> = {},
): CoachBotHealthRepo.HealthTarget => ({
  workspaceId,
  telegramBotId: BOT_ID,
  username: BOT_USERNAME,
  encryptedToken: `sealed:${STALE_TOKEN}`,
  webhookSecretHash: "installed-hash",
  relinkEpisode: 0,
  coachTelegramId: coach,
  coachLanguage: CoachLanguage.make("ru"),
  workspace: { name: "Ada Coaching" },
  ...overrides,
})

const credentialLayer = Layer.succeed(
  CoachBotCredential.Service,
  CoachBotCredential.Service.of({
    encrypt: (token) => Effect.succeed(`sealed:${token}`),
    decrypt: (envelope) => Effect.succeed(envelope.replace(/^sealed:/, "")),
  }),
)

interface HealthStub {
  readonly layer: Layer.Layer<CoachBotHealthRepo.Service>
  readonly checked: Array<WorkspaceId>
  /** What `markChecked` wrote, so a deferral can be told from a full pass. */
  readonly stamps: Array<Date>
  readonly flipped: Array<WorkspaceId>
  readonly repairNotices: Array<{ readonly workspaceId: WorkspaceId; readonly episode: number }>
  /** Replace what `findTarget` answers, as a rotation does in the database. */
  readonly setTarget: (target: CoachBotHealthRepo.HealthTarget) => void
}

/**
 * The flip is modelled the way the repository implements it — conditional, and
 * won once — so "idempotent under repeat" is a property of this suite rather
 * than of a mock that always says yes.
 */
const healthStub = (
  due: ReadonlyArray<CoachBotHealthRepo.HealthTarget> = [],
  options: { readonly alreadyFlagged?: boolean } = {},
): HealthStub => {
  const checked: Array<WorkspaceId> = []
  const stamps: Array<Date> = []
  const flipped: Array<WorkspaceId> = []
  const repairNotices: Array<{ readonly workspaceId: WorkspaceId; readonly episode: number }> = []
  let connected = options.alreadyFlagged !== true
  let episode = 0
  let current = due[0]
  const layer = Layer.succeed(
    CoachBotHealthRepo.Service,
    CoachBotHealthRepo.Service.of({
      dueForCheck: () => Effect.succeed(due),
      findTarget: () => Effect.succeed(current),
      markChecked: (id, at) =>
        Effect.sync(() => {
          checked.push(id)
          stamps.push(at)
        }),
      flagNeedsRelink: (id) =>
        Effect.sync(() => {
          if (!connected) return undefined
          connected = false
          episode += 1
          flipped.push(id)
          return { workspaceId: id, botUsername: BOT_USERNAME, episode }
        }),
      queueRepairNotice: (id, at) =>
        Effect.sync(() => {
          repairNotices.push({ workspaceId: id, episode: at })
        }),
    }),
  )
  return {
    layer,
    checked,
    stamps,
    flipped,
    repairNotices,
    setTarget: (replacement) => {
      current = replacement
    },
  }
}

interface RotateRecord {
  readonly encryptedToken: string
  readonly webhookSecretHash: string
}

const provisioningStub = (
  rotated: Array<RotateRecord>,
  onRotate?: (encryptedToken: string) => void,
) =>
  Layer.succeed(
    CoachBotProvisioningRepo.Service,
    CoachBotProvisioningRepo.Service.of({
      prepare: unsupported,
      claim: unsupported,
      recordPrompt: unsupported,
      ingestCandidate: unsupported,
      findCandidateByBotId: unsupported,
      complete: unsupported,
      reopenForRelink: unsupported,
      findByBotId: unsupported,
      findInFlightManagedAttempt: unsupported,
      findByWorkspace: unsupported,
      workspaceProfile: unsupported,
      rotate: (input) =>
        Effect.sync(() => {
          rotated.push({
            encryptedToken: input.encryptedToken,
            webhookSecretHash: input.webhookSecretHash,
          })
          onRotate?.(input.encryptedToken)
          return {
            workspaceId,
            telegramBotId: input.telegramBotId,
            username: input.username,
            encryptedToken: input.encryptedToken,
            webhookSecretHash: input.webhookSecretHash,
            botInfo: input.botInfo,
          }
        }),
      pendingNotifications: unsupported,
      markNotificationDelivered: unsupported,
      deferNotification: unsupported,
    }),
  )

interface TelegramCall {
  readonly method: string
  readonly token: string
  /** The request payload, for the calls whose shape is the thing under test. */
  readonly payload: Record<string, unknown>
}

interface TelegramStub {
  readonly fetch: typeof globalThis.fetch
  readonly calls: Array<TelegramCall>
}

/** Telegram's own window on a prepared inline message, as the stub mints it. */
const PREPARED_CARD_EXPIRY_SECONDS = Math.floor(Date.parse("2026-07-26T12:30:00.000Z") / 1_000)

/**
 * Telegram, keyed on the credential the call carries. That is the whole point of
 * the fixture: the stale token 401s and the fresh one works, which is exactly
 * the state a `/revoke` leaves behind.
 */
const telegramStub = (
  options: {
    readonly management?: "fresh" | "deleted" | "unmanaged" | "outage" | "manager-token"
    /**
     * What the coach's Telegram profile currently shows. `"none"` by default,
     * because the sweep now asks about it on every healthy tick (#225) and most
     * of this suite is about credentials rather than pictures.
     */
    readonly photo?: PhotoFixture | "none"
  } = {},
): TelegramStub => {
  const calls: Array<TelegramCall> = []
  const photos = telegramPhotoRoutes(options.photo ?? "none")
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input.toString()
    const path = new URL(url).pathname.split("/")
    const method = path.at(-1) ?? ""
    const token = decodeURIComponent(path.at(-2)?.replace(/^bot/, "") ?? "")
    const body = init?.body
    const payload: Record<string, unknown> =
      typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : {}
    calls.push({ method, token, payload })

    if (method === "getManagedBotToken") {
      switch (options.management ?? "fresh") {
        case "deleted":
          return Response.json(
            { ok: false, error_code: 403, description: "Forbidden: user is deactivated" },
            { status: 403 },
          )
        case "unmanaged":
          return Response.json(
            { ok: false, error_code: 400, description: "Bad Request: bot is not managed" },
            { status: 400 },
          )
        case "outage":
          return Response.json(
            { ok: false, error_code: 502, description: "Bad Gateway" },
            { status: 502 },
          )
        case "manager-token":
          return Response.json(
            { ok: false, error_code: 401, description: "Unauthorized" },
            { status: 401 },
          )
        default:
          return Response.json({ ok: true, result: FRESH_TOKEN })
      }
    }
    if (token === STALE_TOKEN) {
      return Response.json(
        { ok: false, error_code: 401, description: "Unauthorized" },
        { status: 401 },
      )
    }
    const photo = photos(url)
    if (photo !== undefined) return photo
    if (method === "savePreparedInlineMessage") {
      return Response.json({
        ok: true,
        result: { id: "prepared-card-1", expiration_date: PREPARED_CARD_EXPIRY_SECONDS },
      })
    }
    if (method === "getMe") {
      return Response.json({
        ok: true,
        result: {
          id: Number(BOT_ID),
          is_bot: true,
          first_name: "Ada Coaching",
          username: BOT_USERNAME,
          can_join_groups: false,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
        },
      })
    }
    return Response.json({ ok: true, result: true })
  }
  return { fetch, calls }
}

const grammyError = (code: number, description: string): GrammyError =>
  new GrammyError("Call failed", { ok: false, error_code: code, description }, "getMe", {} as never)

const check = (
  health: HealthStub,
  telegram: TelegramStub,
  rotated: Array<RotateRecord> = [],
  input = target(),
  /** The coach's stored photo, for the refresh the sweep now runs. */
  avatars: AvatarRepoStub = avatarRepoStub(),
) =>
  checkCoachBot(input).pipe(
    Effect.provide(CoachBotProvisioningRuntime.testLayer(env.UPLOADS, telegram.fetch)),
    Effect.provide(
      Layer.mergeAll(
        health.layer,
        provisioningStub(rotated),
        credentialLayer,
        avatars.layer,
        AvatarStore.testLayer,
      ),
    ),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
  )

describe("classifying a coach bot's refusal", () => {
  it("reads 401 and 404 as a credential that is no longer ours", () => {
    expect(classifyCoachBotFailure(grammyError(401, "Unauthorized"))).toBe("credential-rejected")
    expect(classifyCoachBotFailure(grammyError(404, "Not Found"))).toBe("credential-rejected")
  })

  // Nothing but a definite refusal may start a repair. A Telegram outage or a
  // bug of ours must never be the thing that takes a working bot off its coach.
  it("treats everything else as transient, including our own mistakes", () => {
    expect(classifyCoachBotFailure(grammyError(500, "Internal"))).toBe("transient")
    expect(classifyCoachBotFailure(new HttpError("socket", new Error("socket")))).toBe("transient")
    expect(classifyCoachBotFailure(new Error("typo"))).toBe("transient")
  })
})

describe("classifying the manager's refusal to refresh", () => {
  it("reads a deleted bot and an unmanaged one as unrepairable", () => {
    expect(classifyManagementFailure(grammyError(403, "Forbidden: user is deactivated"))).toBe(
      "unrepairable",
    )
    expect(classifyManagementFailure(grammyError(400, "Bad Request"))).toBe("unrepairable")
  })

  // 401 here is the *manager's* own token being refused. Reading it as "gone"
  // would flip every connected workspace in the sweep over one stack secret.
  it("never reads the manager's own broken credential as a coach's dead bot", () => {
    expect(classifyManagementFailure(grammyError(401, "Unauthorized"))).toBe("transient")
    expect(classifyManagementFailure(grammyError(429, "Too Many Requests"))).toBe("transient")
    expect(classifyManagementFailure(grammyError(502, "Bad Gateway"))).toBe("transient")
  })
})

describe("checking one coach bot", () => {
  it.effect("leaves a working bot alone and records that it was asked", () =>
    Effect.gen(function* () {
      const health = healthStub()
      const telegram = telegramStub()

      const outcome = yield* check(health, telegram, [], target({ encryptedToken: "sealed:fine" }))

      expect(outcome).toEqual({ _tag: "Healthy" })
      expect(health.checked).toEqual([workspaceId])
      expect(health.flipped).toEqual([])
    }),
  )

  it.effect("repairs a revoked bot without the workspace ever leaving connected", () =>
    Effect.gen(function* () {
      const health = healthStub()
      const telegram = telegramStub()
      const rotated: Array<RotateRecord> = []

      const outcome = yield* check(health, telegram, rotated)

      expect(outcome).toEqual({ _tag: "Repaired", username: BOT_USERNAME })
      expect(health.flipped).toEqual([])
      // The refreshed credential is what gets stored, and the full
      // configuration runs around it rather than a bare token swap.
      expect(rotated[0]?.encryptedToken).toBe(`sealed:${FRESH_TOKEN}`)
      const withFresh = telegram.calls.filter((call) => call.token === FRESH_TOKEN)
      expect(withFresh.map((call) => call.method)).toEqual(
        expect.arrayContaining([
          "setChatMenuButton",
          "setMyDescription",
          "setMyShortDescription",
          "setWebhook",
        ]),
      )
      // Once per episode, to the coach alone: an admin does not need to hear
      // about an outage that never happened.
      expect(health.repairNotices).toEqual([{ workspaceId, episode: 0 }])
    }),
  )

  it.effect("flags a deleted bot, and says so exactly once", () =>
    Effect.gen(function* () {
      const health = healthStub()
      const telegram = telegramStub({ management: "deleted" })

      const first = yield* check(health, telegram)
      const second = yield* check(health, telegram)

      expect(first).toEqual({ _tag: "NeedsRelink", username: BOT_USERNAME, episode: 1 })
      expect(second).toEqual({ _tag: "AlreadyFlagged" })
      expect(health.flipped).toEqual([workspaceId])
    }),
  )

  // The paste path (#95) never gave us management rights, so there is nothing to
  // refresh — which is the other half of what `needs re-link` now means.
  it.effect("flags a bot we never managed", () =>
    Effect.gen(function* () {
      const health = healthStub()

      const outcome = yield* check(health, telegramStub({ management: "unmanaged" }))

      expect(outcome).toMatchObject({ _tag: "NeedsRelink" })
    }),
  )

  it.effect("leaves the bot alone when Telegram itself is unavailable", () =>
    Effect.gen(function* () {
      const health = healthStub()

      const outcome = yield* check(health, telegramStub({ management: "outage" }))

      expect(outcome).toEqual({ _tag: "Unchanged", operation: "getManagedBotToken" })
      expect(health.flipped).toEqual([])
      // Stamped, but back-dated: the question is still open, so the bot comes
      // back in an hour rather than holding the batch on every five-minute tick.
      expect(health.checked).toEqual([workspaceId])
      // `dueForCheck` selects on `health_checked_at < now - INTERVAL`, so the
      // back-dated stamp lands this bot back in the batch exactly one retry
      // interval from now.
      const now = yield* Clock.currentTimeMillis
      const dueIn = (health.stamps[0]?.getTime() ?? 0) + HEALTH_CHECK_INTERVAL_MILLIS - now
      expect(dueIn).toBe(HEALTH_RETRY_INTERVAL_MILLIS)
    }),
  )

  it.effect("stamps a healthy bot with now, so it waits the full day", () =>
    Effect.gen(function* () {
      const health = healthStub()

      yield* check(health, telegramStub(), [], target({ encryptedToken: "sealed:fine" }))

      expect(health.stamps[0]?.getTime()).toBe(yield* Clock.currentTimeMillis)
    }),
  )

  it.effect("never flags a workspace because the manager's own token broke", () =>
    Effect.gen(function* () {
      const health = healthStub()

      const outcome = yield* check(health, telegramStub({ management: "manager-token" }))

      expect(outcome).toMatchObject({ _tag: "Unchanged" })
      expect(health.flipped).toEqual([])
    }),
  )

  // The row may only claim a secret Telegram has accepted. A stage with no
  // configured origin arms nothing, so it must keep the hash it had.
  it.effect("keeps the stored webhook secret when there is no origin to re-arm at", () =>
    Effect.gen(function* () {
      const rotated: Array<RotateRecord> = []
      const originless = { ...env, MANAGER_BOT_WEBHOOK_URL: "" }

      const telegram = telegramStub()
      const outcome = yield* checkCoachBot(target()).pipe(
        Effect.provide(CoachBotProvisioningRuntime.testLayer(originless.UPLOADS, telegram.fetch)),
        Effect.provide(
          Layer.mergeAll(
            healthStub().layer,
            provisioningStub(rotated),
            credentialLayer,
            avatarRepoStub().layer,
            AvatarStore.testLayer,
          ),
        ),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(originless))),
      )

      expect(outcome).toMatchObject({ _tag: "Repaired" })
      expect(rotated[0]?.webhookSecretHash).toBe("installed-hash")
    }),
  )
})

describe("the daily sweep", () => {
  it.effect("decides each bot in its batch", () =>
    Effect.gen(function* () {
      const health = healthStub([target(), target({ encryptedToken: "sealed:fine" })])
      const telegram = telegramStub()

      const outcomes = yield* Effect.flatMap(CoachBotProvisioning.Service, (service) =>
        service.sweepCoachBotHealth(),
      ).pipe(
        Effect.provide(
          CoachBotProvisioning.testLayer(env.UPLOADS, telegram.fetch).pipe(
            Layer.provide(
              Layer.mergeAll(
                health.layer,
                provisioningStub([]),
                credentialLayer,
                unusedClientAcceptanceRepo,
                unusedRegistry,
                unusedManagerSender,
                unusedAvatarRepo,
                unusedAvatarStore,
              ),
            ),
          ),
        ),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
      )

      expect(outcomes.map((outcome) => outcome._tag)).toEqual(["Repaired", "Healthy"])
    }),
  )
})

/**
 * The coach's own profile photo, refreshed on the pass that was already asking
 * Telegram about their bot (#225).
 *
 * The sweep is the cadence because a changed picture is not urgent, and the two
 * properties that make it affordable are the ones checked here: an unchanged
 * photo downloads nothing, and nothing about the photo may touch the health
 * decision.
 */
describe("refreshing the coach's photo on the way past", () => {
  const avatarKeyFor = (photo: PhotoFixture): string | undefined =>
    avatarKey({
      subject: "coach",
      subjectId: workspaceId,
      sourceId: photo.fileUniqueId,
      contentType: "image/jpeg",
    })

  it.effect("stores a photo the coach has changed since the last pass", () =>
    Effect.gen(function* () {
      const health = healthStub()
      const telegram = telegramStub({ photo: CHANGED_PHOTO })
      const avatars = avatarRepoStub(avatarKeyFor(COACH_PHOTO))

      const outcome = yield* check(
        health,
        telegram,
        [],
        target({ encryptedToken: "sealed:fine" }),
        avatars,
      )

      expect(outcome).toEqual({ _tag: "Healthy" })
      // What the store accepted is `coach-photo.test.ts`'s subject; here the
      // column is the observable fact, and it moved.
      expect(avatars.key()).toBe(avatarKeyFor(CHANGED_PHOTO))
    }),
  )

  it.effect("downloads nothing for a photo it already holds", () =>
    Effect.gen(function* () {
      const health = healthStub()
      const telegram = telegramStub({ photo: COACH_PHOTO })
      const avatars = avatarRepoStub(avatarKeyFor(COACH_PHOTO))

      yield* check(health, telegram, [], target({ encryptedToken: "sealed:fine" }), avatars)

      // One extra Bot API call per bot per day, and that is the whole cost.
      expect(telegram.calls.filter((call) => call.method === "getFile")).toEqual([])
      expect(avatars.writes).toEqual([])
    }),
  )

  it.effect("refreshes a repaired bot's coach too", () =>
    Effect.gen(function* () {
      const health = healthStub()
      const telegram = telegramStub({ photo: COACH_PHOTO })
      const avatars = avatarRepoStub()

      const outcome = yield* check(health, telegram, [], target(), avatars)

      expect(outcome).toMatchObject({ _tag: "Repaired" })
      expect(avatars.key()).toBe(avatarKeyFor(COACH_PHOTO))
    }),
  )

  it.effect("leaves the health decision and the stamp alone when the photo fails", () =>
    Effect.gen(function* () {
      const health = healthStub()
      // Telegram answers `getMe` but refuses the photo call: a courtesy that
      // failed may not defer the check or take a bot off its coach.
      const telegram = telegramStub({ photo: "none" })
      const failing: AvatarRepoStub = {
        layer: unusedAvatarRepo,
        writes: [],
        key: () => undefined,
      }

      const outcome = yield* check(
        health,
        telegram,
        [],
        target({ encryptedToken: "sealed:fine" }),
        failing,
      )

      expect(outcome).toEqual({ _tag: "Healthy" })
      expect(health.checked).toEqual([workspaceId])
      expect(health.stamps).toHaveLength(1)
    }),
  )

  it.effect("asks about nobody when the workspace has no coach identity bound", () =>
    Effect.gen(function* () {
      const health = healthStub()
      const telegram = telegramStub({ photo: COACH_PHOTO })
      const avatars = avatarRepoStub()
      const { coachTelegramId: _omitted, ...ownerless } = target({
        encryptedToken: "sealed:fine",
      })

      yield* check(health, telegram, [], ownerless, avatars)

      expect(telegram.calls.filter((call) => call.method === "getUserProfilePhotos")).toEqual([])
      expect(avatars.writes).toEqual([])
    }),
  )
})

describe("the origin a repaired webhook is re-armed at", () => {
  it("takes the bot Worker's own public origin, and refuses anything else", () => {
    expect(webhookOriginFrom("https://bot.praximo.test/telegram/manager")).toBe(
      "https://bot.praximo.test",
    )
    expect(webhookOriginFrom("http://bot.praximo.test")).toBeUndefined()
    expect(webhookOriginFrom("")).toBeUndefined()
    expect(webhookOriginFrom(undefined)).toBeUndefined()
  })
})

/**
 * The reactive half of detection (#55). The sweep alone would be correct and a
 * day late: the first message after a coach's `/revoke` is the one that proves
 * the channel matters, so a send that meets a 401 repairs and tries again.
 */
describe("sending through a workspace's own bot", () => {
  const throughRegistry = <A, E>(
    health: HealthStub,
    telegram: TelegramStub,
    rotated: Array<RotateRecord>,
    body: Effect.Effect<A, E, BotRegistry.Service>,
  ) =>
    body.pipe(
      Effect.provide(
        BotRegistryLive.layerWithFetch(env.UPLOADS, telegram.fetch).pipe(
          Layer.provide(
            Layer.mergeAll(
              health.layer,
              // A rotation is what the retry depends on: without it the second
              // attempt would reach for the same refused credential.
              provisioningStub(rotated, (encryptedToken) =>
                health.setTarget(target({ encryptedToken })),
              ),
              credentialLayer,
            ),
          ),
        ),
      ),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
    )

  const send = (health: HealthStub, telegram: TelegramStub, rotated: Array<RotateRecord> = []) =>
    throughRegistry(
      health,
      telegram,
      rotated,
      Effect.flatMap(BotRegistry.Service, (registry) => registry.send(workspaceId, "hello")),
    )

  it.effect("repairs a refused credential inline and lands the message on the retry", () =>
    Effect.gen(function* () {
      const health = healthStub([target()])
      const telegram = telegramStub()

      yield* send(health, telegram)

      // Two sends: the one the stale token refused, and the one the refreshed
      // credential carried.
      const sends = telegram.calls.filter((call) => call.method === "sendMessage")
      expect(sends.map((call) => call.token)).toEqual([STALE_TOKEN, FRESH_TOKEN])
      expect(health.flipped).toEqual([])
    }),
  )

  it.effect("fails the send once the bot turns out to be unrepairable", () =>
    Effect.gen(function* () {
      const health = healthStub([target()])

      const failure = yield* Effect.flip(send(health, telegramStub({ management: "deleted" })))

      expect(failure).toMatchObject({
        _tag: "BotRegistry.SendFailed",
        reason: "bot needs re-link",
      })
      // And the same flip the sweep would have taken, from the same seam.
      expect(health.flipped).toEqual([workspaceId])
    }),
  )

  /**
   * The invitation card (#179), which shares every one of those properties
   * because it shares the seam: one credential, one repair, one retry. What is
   * its own is the shape Telegram is asked for — a `url` button, because inline
   * messages do not allow `web_app` ones, and a window read off the answer.
   */
  const card: BotRegistry.InviteCard = {
    title: "Anna",
    text: "Anna opens your bot in Telegram and accepts there.",
    buttonText: "Open the invitation",
    buttonUrl: `https://t.me/${BOT_USERNAME}?start=inv_ABCDEFGH2345`,
  }

  const prepare = (health: HealthStub, telegram: TelegramStub, rotated: Array<RotateRecord> = []) =>
    throughRegistry(
      health,
      telegram,
      rotated,
      Effect.flatMap(BotRegistry.Service, (registry) => registry.prepareCard(workspaceId, card)),
    )

  it.effect("asks the coach's own bot for a card the coach can send to one person", () =>
    Effect.gen(function* () {
      const health = healthStub([target({ encryptedToken: "sealed:fine" })])
      const telegram = telegramStub()

      const prepared = yield* prepare(health, telegram)

      const call = telegram.calls.find((entry) => entry.method === "savePreparedInlineMessage")
      // The coach is both the user the card is bound to and the one who sends
      // it, so a private chat with one client is the whole of its reach.
      expect(call?.payload.user_id).toBe(Number(coach))
      expect(call?.payload.allow_user_chats).toBe(true)
      const result = call?.payload.result as {
        readonly reply_markup: { readonly inline_keyboard: ReadonlyArray<ReadonlyArray<unknown>> }
      }
      // A `url` deep link into this same bot. `web_app` buttons are not allowed
      // in an inline message, so there is nothing to fall back to here.
      expect(result.reply_markup.inline_keyboard[0]?.[0]).toEqual({
        text: card.buttonText,
        url: card.buttonUrl,
      })
      // Telegram's own window, read rather than assumed.
      expect(prepared.expiresAt.toISOString()).toBe("2026-07-26T12:30:00.000Z")
      expect(prepared.id).toBe("prepared-card-1")
    }),
  )

  it.effect("repairs a refused credential inline and mints the card on the retry", () =>
    Effect.gen(function* () {
      const health = healthStub([target()])
      const telegram = telegramStub()

      const prepared = yield* prepare(health, telegram)

      const mints = telegram.calls.filter((entry) => entry.method === "savePreparedInlineMessage")
      expect(mints.map((entry) => entry.token)).toEqual([STALE_TOKEN, FRESH_TOKEN])
      expect(prepared.id).toBe("prepared-card-1")
      expect(health.flipped).toEqual([])
    }),
  )

  it.effect("fails the share once the bot turns out to be unrepairable", () =>
    Effect.gen(function* () {
      const health = healthStub([target()])

      const failure = yield* Effect.flip(prepare(health, telegramStub({ management: "deleted" })))

      expect(failure).toMatchObject({
        _tag: "BotRegistry.PrepareFailed",
        reason: "bot needs re-link",
      })
      expect(health.flipped).toEqual([workspaceId])
    }),
  )
})
