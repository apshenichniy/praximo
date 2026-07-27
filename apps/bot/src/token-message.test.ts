import { describe, expect, it } from "@effect/vitest"
import { messages } from "./messages.ts"
import { handleRequest } from "./runtime.ts"

// Same dummy env as the other worker tests: nothing here reaches Postgres, the
// pasted token is refused by Telegram before any query would run.
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

const TOKEN = "9100777:AAHkq2Lb8fN1sQx3TzVpYr7WcJd4MgEuKvB"

const tokenMessage = (text: string) => ({
  update_id: 77,
  message: {
    message_id: 9,
    date: 0,
    chat: { id: 123456789, type: "private" },
    from: { id: 123456789, is_bot: false, first_name: "Ada", language_code: "ru" },
    text,
  },
})

describe("manager bot token message", () => {
  it("deletes the credential message before it is even validated", async () => {
    const calls: Array<{ readonly method: string; readonly token: string }> = []
    const replies: Array<string> = []
    const telegramFetch: typeof fetch = async (input, init) => {
      const [, credential = "", method = ""] = new URL(input.toString()).pathname.split("/")
      const token = credential.replace(/^bot/, "")
      calls.push({ method, token })
      if (method === "getMe" && token === env.MANAGER_BOT_TOKEN) {
        return Response.json({
          ok: true,
          result: {
            id: 5100,
            is_bot: true,
            first_name: "Praximo Manager",
            username: env.MANAGER_BOT_USERNAME,
            can_join_groups: false,
            can_read_all_group_messages: false,
            supports_inline_queries: false,
          },
        })
      }
      if (method === "getMe") {
        // The pasted credential is a dud — the deletion has to have happened
        // regardless, which is what this test is about.
        return Response.json(
          { ok: false, error_code: 401, description: "Unauthorized" },
          { status: 401 },
        )
      }
      if (method === "sendMessage") {
        replies.push(String(JSON.parse(String(init?.body)).text))
        return Response.json({ ok: true, result: { message_id: 10 } })
      }
      return Response.json({ ok: true, result: true })
    }

    const response = await handleRequest(
      new Request("https://bot.praximo.test/telegram/manager", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": env.MANAGER_BOT_WEBHOOK_SECRET },
        body: JSON.stringify(
          tokenMessage(`Done! Use this token to access the HTTP API:\n${TOKEN}`),
        ),
      }),
      env,
      telegramFetch,
    )

    expect(response.status).toBe(200)
    expect(calls.map((call) => call.method)).toEqual([
      "getMe",
      "deleteMessage",
      "getMe",
      "sendMessage",
    ])
    // In the coach's language, and never echoing what they pasted.
    expect(replies[0]).toBe(messages("ru").tokenInvalid)
    expect(replies[0]).not.toContain(TOKEN)
  })

  it("ignores an ordinary message that carries no credential", async () => {
    const calls: Array<string> = []
    const telegramFetch: typeof fetch = async (input) => {
      const method = new URL(input.toString()).pathname.split("/").at(-1) ?? ""
      calls.push(method)
      return Response.json({ ok: true, result: true })
    }

    const response = await handleRequest(
      new Request("https://bot.praximo.test/telegram/manager", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": env.MANAGER_BOT_WEBHOOK_SECRET },
        body: JSON.stringify(tokenMessage("hi, how do I connect my bot?")),
      }),
      env,
      telegramFetch,
    )

    expect(response.status).toBe(200)
    expect(calls).not.toContain("deleteMessage")
    expect(calls).not.toContain("sendMessage")
  })
})
