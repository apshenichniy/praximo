import { describe, expect, it } from "vitest"
import { handleRequest } from "./runtime.ts"

// The health route builds WorkspaceRepo over the real Neon connection (#47),
// which reads DATABASE_URL from the app's ConfigProvider over the Worker env. On
// the deployed dev worker that's the alchemy secret binding; here a well-formed
// dummy lets the client construct without ever opening a connection (health runs
// no query).
const env = {
  DATABASE_URL:
    "postgresql://user:pass@ep-dummy-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require",
  UPLOADS: {
    delete: () => Promise.resolve(),
  },
}

describe("pipeline worker", () => {
  it("boots its runtime and answers the health route", async () => {
    const response = await handleRequest(new Request("https://pipeline.praximo.test/health"), env)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ app: "pipeline", status: "ok" })
  })

  it("404s off the health route", async () => {
    const response = await handleRequest(new Request("https://pipeline.praximo.test/"), env)

    expect(response.status).toBe(404)
  })
})
