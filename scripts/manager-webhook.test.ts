import { describe, expect, it, vi } from "vitest"
import { configureManagerWebhook, endpointFor } from "./manager-webhook.ts"

describe("manager webhook setup", () => {
  it("builds the fixed manager route from a worker origin", () => {
    expect(endpointFor("https://praximo-bot.example.workers.dev/old?q=1")).toBe(
      "https://praximo-bot.example.workers.dev/telegram/manager",
    )
    expect(() => endpointFor("http://localhost:8787")).toThrow(/https/)
  })

  it("sets the secret and the only update types consumed by the manager bot", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: true }),
    )
    await configureManagerWebhook(
      {
        token: "123:token",
        secret: "secret_value",
        workerUrl: "https://praximo-bot.example.workers.dev",
      },
      fetch,
    )

    expect(fetch).toHaveBeenCalledOnce()
    const [, init] = fetch.mock.calls[0]!
    expect(JSON.parse(String(init?.body))).toEqual({
      url: "https://praximo-bot.example.workers.dev/telegram/manager",
      secret_token: "secret_value",
      allowed_updates: ["message", "managed_bot"],
    })
  })
})
