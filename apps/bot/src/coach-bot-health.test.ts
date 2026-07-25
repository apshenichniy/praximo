import { describe, expect, it } from "@effect/vitest"
import { CoachBotHealthRepo, CoachBotProvisioningRepo } from "@praximo/db"
import { CoachLanguage, TelegramId, WorkspaceId } from "@praximo/domain"
import { CoachBotCredential } from "@praximo/telegram"
import { GrammyError, HttpError } from "grammy"
import { Effect, Layer } from "effect"
import {
  checkCoachBot,
  classifyCoachBotFailure,
  classifyManagementFailure,
  sweepCoachBotHealth,
  webhookOriginFrom,
} from "./coach-bot-health.ts"
import { BRANDING_AVATAR_BYTES, BRANDING_AVATAR_KEY, uploadsStub } from "./__tests__/uploads.ts"

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
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: BRANDING_AVATAR_KEY,
  COACH_MINI_APP_URL: "https://stage.praximo.io/",
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
  readonly flipped: Array<WorkspaceId>
  readonly repairNotices: Array<{ readonly workspaceId: WorkspaceId; readonly episode: number }>
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
  const flipped: Array<WorkspaceId> = []
  const repairNotices: Array<{ readonly workspaceId: WorkspaceId; readonly episode: number }> = []
  let connected = options.alreadyFlagged !== true
  let episode = 0
  const layer = Layer.succeed(
    CoachBotHealthRepo.Service,
    CoachBotHealthRepo.Service.of({
      dueForCheck: () => Effect.succeed(due),
      findTarget: () => Effect.succeed(due[0]),
      markChecked: (id) =>
        Effect.sync(() => {
          checked.push(id)
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
  return { layer, checked, flipped, repairNotices }
}

interface RotateRecord {
  readonly encryptedToken: string
  readonly webhookSecretHash: string
}

const provisioningStub = (rotated: Array<RotateRecord>) =>
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

interface TelegramStub {
  readonly fetch: typeof globalThis.fetch
  readonly calls: Array<{ readonly method: string; readonly token: string }>
}

/**
 * Telegram, keyed on the credential the call carries. That is the whole point of
 * the fixture: the stale token 401s and the fresh one works, which is exactly
 * the state a `/revoke` leaves behind.
 */
const telegramStub = (
  options: {
    readonly management?: "fresh" | "deleted" | "unmanaged" | "outage" | "manager-token"
  } = {},
): TelegramStub => {
  const calls: Array<{ readonly method: string; readonly token: string }> = []
  const fetch: typeof globalThis.fetch = async (input) => {
    const path = new URL(input.toString()).pathname.split("/")
    const method = path.at(-1) ?? ""
    const token = decodeURIComponent(path.at(-2)?.replace(/^bot/, "") ?? "")
    calls.push({ method, token })

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
) =>
  checkCoachBot(env, input, telegram.fetch).pipe(
    Effect.provide(Layer.mergeAll(health.layer, provisioningStub(rotated), credentialLayer)),
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
      // Not marked either: the next tick has to find it again.
      expect(health.checked).toEqual([])
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

      const outcome = yield* checkCoachBot(originless, target(), telegramStub().fetch).pipe(
        Effect.provide(
          Layer.mergeAll(healthStub().layer, provisioningStub(rotated), credentialLayer),
        ),
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

      const outcomes = yield* sweepCoachBotHealth(env, telegram.fetch).pipe(
        Effect.provide(Layer.mergeAll(health.layer, provisioningStub([]), credentialLayer)),
      )

      expect(outcomes.map((outcome) => outcome._tag)).toEqual(["Repaired", "Healthy"])
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
