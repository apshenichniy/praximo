import { describe, expect, it } from "@effect/vitest"
import type { CoachBotProvisioningRepo } from "@praximo/db"
import { Effect } from "effect"
import { coachMiniAppUrl, configureCoachBot } from "./provisioning.ts"
import { BRANDING_AVATAR_BYTES, BRANDING_AVATAR_KEY, uploadsStub } from "./__tests__/uploads.ts"

const TOKEN = "9100777:AAHkq2Lb8fN1sQx3TzVpYr7WcJd4MgEuKvB"
const BOT_ID = "9100777"

const WORKSPACE_AVATAR_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02])

const env = {
  MANAGER_BOT_TOKEN: "manager-token",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: BRANDING_AVATAR_KEY,
  COACH_MINI_APP_URL: "https://coach.praximo.io/",
  CLIENT_APP_URL: "https://me.praximo.io",
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

      // A missing picture costs the bot its photo and nothing else: the rest of
      // the branding still lands, and the caller goes on to activate the bot, set
      // its menu button (#156) and arm its webhook (#150).
      const methods = telegram.calls.map((call) => call.method)
      expect(methods).not.toContain("setMyProfilePhoto")
      expect(methods).toContain("setMyDescription")
      expect(methods).toContain("setMyShortDescription")
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
      expect(methods).toContain("setMyDescription")
    }),
  )
})

describe("coach Mini App URL", () => {
  it("names the bot without disturbing whatever else the base carries", () => {
    expect(coachMiniAppUrl("https://coach.praximo.io/", "9100777")).toBe(
      "https://coach.praximo.io/?b=9100777",
    )
    expect(coachMiniAppUrl("https://coach.praximo.io/app?utm=x", "9100777")).toBe(
      "https://coach.praximo.io/app?utm=x&b=9100777",
    )
    // Re-provisioning the same bot reproduces the same URL rather than stacking
    // a second `b`, which Telegram would hand the app as an array.
    expect(coachMiniAppUrl(coachMiniAppUrl("https://coach.praximo.io/", "1"), "2")).toBe(
      "https://coach.praximo.io/?b=2",
    )
  })

  it("hands back a base it cannot parse rather than throwing at a reply site", () => {
    // Both inline-button callers run after a bot is connected, and the app
    // resolves a launch with no `b` by identity. `setCoachBotMenuButton` is where an
    // unusable value is refused — before anything is branded.
    expect(coachMiniAppUrl("not a url", "9100777")).toBe("not a url")
  })
})
