import { describe, expect, it } from "@effect/vitest"
import { messages } from "./messages.ts"
import { handleRequest } from "./runtime.ts"

/**
 * The creation prompt's second button, end to end through the webhook (#164).
 *
 * Its own file because `runtime.ts` memoizes the manager bot per module: the
 * first update through a given module instance fixes the `fetch` every later one
 * uses, so a test that needs its own Telegram stub needs its own module.
 *
 * The bug this closes was not in the handler at all — `setWebhook` was
 * registered with `allowed_updates: ["message", "managed_bot"]`, so Telegram
 * never delivered the tap and the coach watched a button spin. That list lives
 * in `scripts/manager-webhook.ts` and is pinned by its own test; this one pins
 * the half that runs once the update does arrive.
 */
const env = {
  DATABASE_URL:
    "postgresql://user:pass@ep-dummy-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require",
  MANAGER_BOT_TOKEN: "test-token",
  MANAGER_BOT_USERNAME: "PraximoManagerBot",
  MANAGER_BOT_WEBHOOK_SECRET: "test-webhook-secret",
  COACH_BOT_CREDENTIAL_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: "branding/default-coach-avatar.jpg",
  COACH_MINI_APP_URL: "https://stage.praximo.io/",
  CLIENT_APP_URL: "https://my-stage.praximo.io",
  UPLOADS: {} as R2Bucket,
}

interface Call {
  readonly method: string
  readonly body: Record<string, unknown>
}

const telegramStub = () => {
  const calls: Array<Call> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const method = new URL(input.toString()).pathname.split("/").at(-1) ?? ""
    calls.push({
      method,
      body: init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Call["body"]),
    })
    if (method === "getMe") {
      return Response.json({
        ok: true,
        result: {
          id: 5100,
          is_bot: true,
          first_name: "Praximo Manager",
          username: "PraximoManagerBot",
          can_join_groups: false,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
        },
      })
    }
    return Response.json({ ok: true, result: true })
  }
  return { calls, fetch }
}

const callbackUpdate = (data: string) =>
  new Request("https://bot.praximo.test/telegram/manager", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": env.MANAGER_BOT_WEBHOOK_SECRET },
    body: JSON.stringify({
      update_id: 77,
      callback_query: {
        id: "3000",
        from: { id: 123456789, is_bot: false, first_name: "Ada", language_code: "en" },
        chat_instance: "-1",
        data,
        message: {
          message_id: 41,
          date: 0,
          chat: { id: 123456789, type: "private" },
          from: { id: 5100, is_bot: true, first_name: "Praximo Manager" },
          text: "…",
        },
      },
    }),
  })

describe("the “I already have a bot” button", () => {
  /**
   * Both taps go through one stub, and they have to: the memoized bot keeps the
   * `fetch` it was built with, so a second stub would record nothing.
   */
  it("answers the tap with the @BotFather steps, in the language the button carries", async () => {
    const telegram = telegramStub()

    const response = await handleRequest(callbackUpdate("have-bot:ru"), env, telegram.fetch)

    expect(response.status).toBe(200)
    // Answering is what stops Telegram's loading state on the button. Without
    // it the coach watches a spinner until their client gives up.
    const answered = telegram.calls.find((call) => call.method === "answerCallbackQuery")
    expect(answered?.body.callback_query_id).toBe("3000")

    const sent = telegram.calls.find((call) => call.method === "sendMessage")
    // The coach's language rides in the callback data, not in their client: this
    // sender's Telegram is English and the button was sent in Russian.
    expect(sent?.body.text).toBe(messages("ru").haveBotInstructions)
    expect(sent?.body.parse_mode).toBe("HTML")
    expect(sent?.body.chat_id).toBe(123456789)

    // Data that made a round trip is still narrowed on the way back in, so a
    // language we do not speak answers in the one everything is authored in.
    const beforeSecondTap = telegram.calls.length
    await handleRequest(callbackUpdate("have-bot:kl"), env, telegram.fetch)

    const fallback = telegram.calls
      .slice(beforeSecondTap)
      .find((call) => call.method === "sendMessage")
    expect(fallback?.body.text).toBe(messages("en").haveBotInstructions)
  })
})
