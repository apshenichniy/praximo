import { describe, expect, it } from "vitest"

import { Route, healthGet, healthPayload } from "@/routes/health.ts"

describe("health route", () => {
  it("returns the #46 dev-stack payload", () => {
    expect(healthPayload()).toEqual({ app: "web", status: "ok" })
  })

  it("serves it as JSON from the GET handler", async () => {
    const response = healthGet()

    expect(response.headers.get("content-type")).toContain("application/json")
    expect(await response.json()).toEqual({ app: "web", status: "ok" })
  })

  it("wires the GET handler onto the server route", () => {
    // `handlers` is typed as a methods-record | factory union; narrow to read GET.
    const handlers = Route.options.server?.handlers as { GET?: unknown } | undefined

    expect(handlers?.GET).toBe(healthGet)
  })
})
