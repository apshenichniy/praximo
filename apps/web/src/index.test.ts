import { describe, expect, it } from "vitest"
import worker, { handleRequest } from "./index.ts"

describe("web worker", () => {
  it("boots its runtime and answers the health route", async () => {
    const response = await handleRequest(new Request("https://web.praximo.test/health"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ app: "web", status: "ok" })
  })

  it("404s off the health route", async () => {
    const response = await handleRequest(new Request("https://web.praximo.test/"))

    expect(response.status).toBe(404)
  })

  it("exposes the handler as the Worker's fetch entrypoint", () => {
    expect(worker.fetch).toBe(handleRequest)
  })
})
