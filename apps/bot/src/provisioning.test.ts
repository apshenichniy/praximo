import { describe, expect, it } from "@effect/vitest"
import type { CoachBotProvisioningRepo } from "@praximo/db"
import { Effect } from "effect"
import { CoachMenuButtonText, coachMiniAppUrl, configureCoachBot } from "./provisioning.ts"
import { BRANDING_AVATAR_BYTES, BRANDING_AVATAR_KEY, uploadsStub } from "./__tests__/uploads.ts"

const TOKEN = "9100777:AAHkq2Lb8fN1sQx3TzVpYr7WcJd4MgEuKvB"
const BOT_ID = "9100777"

const WORKSPACE_AVATAR_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02])

const env = {
  MANAGER_BOT_TOKEN: "manager-token",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: BRANDING_AVATAR_KEY,
  COACH_MINI_APP_URL: "https://stage.praximo.io/",
  UPLOADS: uploadsStub({ [BRANDING_AVATAR_KEY]: BRANDING_AVATAR_BYTES }).bucket,
}

// No stored avatar key of its own, so this workspace gets the platform image.
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

/** `refuses` names a method Telegram rejects, the way it rejects a bad photo. */
const telegramStub = (refuses?: string): TelegramStub => {
  const calls: Array<Call> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const [, credential = "", method = ""] = new URL(input.toString()).pathname.split("/")
    const body = init?.body
    calls.push({
      method,
      token: credential.replace(/^bot/, ""),
      body: typeof body === "string" ? JSON.parse(body) : undefined,
    })
    if (method === refuses) {
      return Response.json(
        { ok: false, error_code: 400, description: "Bad Request: PHOTO_INVALID_DIMENSIONS" },
        { status: 400 },
      )
    }
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

const configure = (
  telegram: TelegramStub,
  overrides: Partial<typeof env> = {},
  profile: CoachBotProvisioningRepo.WorkspaceProfile = workspace,
) =>
  configureCoachBot({
    env: { ...env, ...overrides },
    token: TOKEN,
    botId: BOT_ID,
    workspace: profile,
    coachName: "Ada",
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

  it.effect("dresses the bot in the stage's stored branding image, not a generated one", () =>
    Effect.gen(function* () {
      const telegram = telegramStub()
      const bucket = uploadsStub({ [BRANDING_AVATAR_KEY]: BRANDING_AVATAR_BYTES })

      yield* configure(telegram, { UPLOADS: bucket.bucket })

      // One stage-wide object, replaced by upload rather than by deploy (#138).
      expect(bucket.reads).toEqual([BRANDING_AVATAR_KEY])
      expect(telegram.calls.map((call) => call.method)).toContain("setMyProfilePhoto")
    }),
  )

  it.effect("keeps a workspace's own stored avatar ahead of the platform one", () =>
    Effect.gen(function* () {
      const telegram = telegramStub()
      const bucket = uploadsStub({
        [BRANDING_AVATAR_KEY]: BRANDING_AVATAR_BYTES,
        "avatars/ada.jpg": WORKSPACE_AVATAR_BYTES,
      })

      // Set by the manager before #108 removed admin-side branding; a bot that
      // already wears it must not be re-skinned by a re-provisioning.
      yield* configure(
        telegram,
        { UPLOADS: bucket.bucket },
        { ...workspace, avatarR2Key: "avatars/ada.jpg" },
      )

      expect(bucket.reads).toEqual(["avatars/ada.jpg"])
    }),
  )

  it.effect("onboards the coach even when the stage never uploaded a branding image", () =>
    Effect.gen(function* () {
      const telegram = telegramStub()

      yield* configure(telegram, { UPLOADS: uploadsStub().bucket })

      // A missing picture costs the bot its photo and nothing else: the menu
      // button — the part of configuration that makes the bot usable — still
      // lands, and the caller goes on to arm the webhook (#150).
      const methods = telegram.calls.map((call) => call.method)
      expect(methods).not.toContain("setMyProfilePhoto")
      expect(methods).toContain("setChatMenuButton")
    }),
  )

  it.effect("onboards the coach even when Telegram rejects the stored image", () =>
    Effect.gen(function* () {
      const telegram = telegramStub("setMyProfilePhoto")

      yield* configure(telegram)

      // The object is no longer computed from the bot id, so anyone with write
      // access to the bucket can put something Telegram refuses there. Every
      // retry would fail on it identically — stranding the coach — so the photo
      // is dropped rather than the onboarding.
      const methods = telegram.calls.map((call) => call.method)
      expect(methods).toContain("setMyProfilePhoto")
      expect(methods).toContain("setChatMenuButton")
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
