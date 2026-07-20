import { describe, expect, it } from "vitest"
import worker, { handleRequest } from "./index.ts"

describe("bot worker", () => {
  it("boots its runtime and answers the health route", async () => {
    const response = await handleRequest(new Request("https://bot.praximo.test/health"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ app: "bot", status: "ok" })
  })

  it("404s off the health route", async () => {
    const response = await handleRequest(new Request("https://bot.praximo.test/"))

    expect(response.status).toBe(404)
  })

  it("exposes the handler as the Worker's fetch entrypoint", () => {
    expect(worker.fetch).toBe(handleRequest)
  })
})
