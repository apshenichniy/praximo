import { describe, expect, it } from "@effect/vitest"
import type { CoachBotProvisioningRepo } from "@praximo/db"
import { Effect } from "effect"
import { CoachMenuButtonText, coachMiniAppUrl, configureCoachBot } from "./provisioning.ts"

const TOKEN = "9100777:AAHkq2Lb8fN1sQx3TzVpYr7WcJd4MgEuKvB"
const BOT_ID = "9100777"

const env = {
  MANAGER_BOT_TOKEN: "manager-token",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: "branding/default-coach-avatar.jpg",
  COACH_MINI_APP_URL: "https://stage.praximo.io/",
  UPLOADS: {} as R2Bucket,
}

// No stored avatar key, so the avatar is generated in-process and R2 is never
// touched — the menu-button call is what these tests are about.
const workspace: CoachBotProvisioningRepo.WorkspaceProfile = { name: "Ada Coaching" }

interface Call {
  readonly method: string
  readonly token: string
  readonly body: unknown
}

interface TelegramStub {
  readonly fetch: typeof globalThis.fetch
  readonly calls: Array<Call>
}

const telegramStub = (): TelegramStub => {
  const calls: Array<Call> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const [, credential = "", method = ""] = new URL(input.toString()).pathname.split("/")
    const body = init?.body
    calls.push({
      method,
      token: credential.replace(/^bot/, ""),
      body: typeof body === "string" ? JSON.parse(body) : undefined,
    })
    if (method === "getMe") {
      return Response.json({
        ok: true,
        result: {
          id: Number(BOT_ID),
          is_bot: true,
          first_name: "Ada Bot",
          username: "ada_coach_bot",
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

const configure = (telegram: TelegramStub, overrides: Partial<typeof env> = {}) =>
  configureCoachBot({
    env: { ...env, ...overrides },
    token: TOKEN,
    botId: BOT_ID,
    workspace,
    coachName: "Ada",
    webhookOrigin: "https://bot.praximo.test",
    telegramFetch: telegram.fetch,
  })

describe("coach bot configuration", () => {
  it.effect("labels the in-chat menu button “Open” and points it at the coach Mini App", () =>
    Effect.gen(function* () {
      const telegram = telegramStub()

      yield* configure(telegram)

      const menu = telegram.calls.find((call) => call.method === "setChatMenuButton")
      // The label is the platform-wide "Open" of ADR 0004 §Mini App entry points,
      // the same word the chat-list Main Mini App button carries — a coach who
      // enables that one in @BotFather must not end up with two different words
      // for the same app.
      expect(menu?.body).toEqual({
        menu_button: {
          type: "web_app",
          text: CoachMenuButtonText,
          // Self-identifying: the launch names the bot it came from, so the app
          // can verify the signature against that bot before it reads anything
          // (ADR 0006). The value is untrusted — the signature is what binds it.
          web_app: { url: `${env.COACH_MINI_APP_URL}?b=${BOT_ID}` },
        },
      })
      expect(CoachMenuButtonText).toBe("Open")
      // The coach bot's own credential, never the manager's: the button belongs
      // to the bot the coach owns.
      expect(menu?.token).toBe(TOKEN)
    }),
  )

  it.effect("refuses a Mini App URL Telegram would not accept as a web_app", () =>
    Effect.gen(function* () {
      const telegram = telegramStub()

      const failure = yield* Effect.flip(
        configure(telegram, { COACH_MINI_APP_URL: "http://stage.praximo.io/" }),
      )

      expect(failure).toMatchObject({
        _tag: "BotWorker.TelegramSetupFailed",
        operation: "miniAppUrl.validate",
      })
      // Nothing past `getMe` ran: a bot is never left branded but unopenable.
      expect(telegram.calls.map((call) => call.method)).toEqual(["getMe"])
    }),
  )
})

describe("coach Mini App URL", () => {
  it("names the bot without disturbing whatever else the base carries", () => {
    expect(coachMiniAppUrl("https://stage.praximo.io/", "9100777")).toBe(
      "https://stage.praximo.io/?b=9100777",
    )
    expect(coachMiniAppUrl("https://stage.praximo.io/app?utm=x", "9100777")).toBe(
      "https://stage.praximo.io/app?utm=x&b=9100777",
    )
    // Re-provisioning the same bot reproduces the same URL rather than stacking
    // a second `b`, which Telegram would hand the app as an array.
    expect(coachMiniAppUrl(coachMiniAppUrl("https://stage.praximo.io/", "1"), "2")).toBe(
      "https://stage.praximo.io/?b=2",
    )
  })

  it("hands back a base it cannot parse rather than throwing at a reply site", () => {
    // Both inline-button callers run after a bot is connected, and the app
    // resolves a launch with no `b` by identity. `configureCoachBot` is where an
    // unusable value is refused — before anything is branded.
    expect(coachMiniAppUrl("not a url", "9100777")).toBe("not a url")
  })
})
