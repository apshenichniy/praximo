import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { CoachMenuButtonText, setCoachBotMenuButton } from "./provisioning.ts"

/**
 * The coach bot's in-chat menu button — the **Open** next to the message input
 * (#156), not the chat-list Main Mini App, which no API can set (ADR 0004).
 *
 * Its own step rather than part of configuration because *when* it runs decides
 * whether the coach sees it: a Telegram client caches a bot's menu button when it
 * opens the chat, and the coach opens theirs by tapping **Start bot** the moment
 * the bot exists. Setting it at the end of configuration meant their client had
 * already looked — verified live, and confirmed by the button appearing as soon
 * as the chat was reopened.
 */

const TOKEN = "9100010:AAHkq2Lb8fN1sQx3TzVpYr7WcJd4MgEuKvB"
const BOT_ID = "9100010"
const MINI_APP_URL = "https://stage.praximo.io/"

interface TelegramCall {
  readonly method: string
  readonly token: string
  readonly body: Record<string, unknown>
}

const telegramStub = (failing?: string) => {
  const calls: Array<TelegramCall> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const [, credential = "", method = ""] = new URL(input.toString()).pathname.split("/")
    const raw = init?.body
    calls.push({
      method,
      token: credential.replace(/^bot/, ""),
      body: typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : {},
    })
    if (method === failing) {
      return Response.json({ ok: false, error_code: 400, description: "Bad Request" })
    }
    return Response.json({ ok: true, result: true })
  }
  return { fetch, calls }
}

const setButton = (telegram: ReturnType<typeof telegramStub>, miniAppBaseUrl = MINI_APP_URL) =>
  setCoachBotMenuButton({
    token: TOKEN,
    botId: BOT_ID,
    miniAppBaseUrl,
    telegramFetch: telegram.fetch,
  })

describe("the coach bot's menu button", () => {
  it.effect("is labelled “Open” and points at the coach Mini App for that bot", () =>
    Effect.gen(function* () {
      const telegram = telegramStub()

      yield* setButton(telegram)

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
          web_app: { url: `${MINI_APP_URL}?b=${BOT_ID}` },
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

      const failure = yield* Effect.flip(setButton(telegram, "http://stage.praximo.io/"))

      expect(failure).toMatchObject({
        _tag: "BotWorker.TelegramSetupFailed",
        operation: "miniAppUrl.validate",
      })
      // Nothing was called at all. Since this is now the first step of
      // provisioning, an unusable Mini App URL fails before the bot is branded
      // *and* before the coach has been promised anything (#156).
      expect(telegram.calls).toEqual([])
    }),
  )

  it.effect("fails provisioning when Telegram refuses the button", () =>
    Effect.gen(function* () {
      const telegram = telegramStub("setChatMenuButton")

      const failure = yield* Effect.flip(setButton(telegram))

      // Not best-effort, unlike the photo: the menu button is the coach's standing
      // way into the Mini App, so a bot that cannot get one is not a bot to
      // connect. The `managed_bot` update is redelivered and tries again.
      expect(failure).toMatchObject({
        _tag: "BotWorker.TelegramSetupFailed",
        operation: "setChatMenuButton",
      })
    }),
  )
})
