import { describe, expect, it } from "vitest"
import { handleRequest } from "./index.ts"

describe("pipeline worker", () => {
  it("boots its runtime and answers a request", async () => {
    const response = await handleRequest()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ app: "pipeline", status: "ok" })
  })
})
