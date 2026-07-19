import { describe, expect, it } from "vitest"
import worker, { handleRequest } from "./index.ts"

describe("bot worker", () => {
  it("boots its runtime and answers a request", async () => {
    const response = await handleRequest(new Request("https://bot.praximo.test/"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ app: "bot", status: "ok" })
  })

  it("exposes the handler as the Worker's fetch entrypoint", () => {
    expect(worker.fetch).toBe(handleRequest)
  })
})
