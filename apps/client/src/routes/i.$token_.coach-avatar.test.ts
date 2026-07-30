import { describe, expect, it } from "vitest"

import { avatarResponse } from "./i.$token_.coach-avatar.ts"

/**
 * Turning the storage package's description into a real response (#231).
 *
 * Two lines of code and worth a suite for one reason: `Response` refuses a body on
 * a 304, so the branch that saves the client a download is also the one branch that
 * can throw — on a route whose whole job is to fail invisibly.
 */
describe("avatarResponse", () => {
  it("carries the bytes and every header the reader set", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff])

    const response = avatarResponse({
      status: 200,
      headers: { "Content-Type": "image/jpeg", ETag: '"1a2b3c"' },
      body: bytes,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/jpeg")
    expect(response.headers.get("etag")).toBe('"1a2b3c"')
  })

  it("builds a 304 without a body rather than throwing on one", () => {
    const response = avatarResponse({
      status: 304,
      headers: { ETag: '"1a2b3c"', "Cache-Control": "private, max-age=0, must-revalidate" },
    })

    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
    expect(response.headers.get("etag")).toBe('"1a2b3c"')
  })

  it("builds a bodiless refusal the same way", () => {
    const response = avatarResponse({ status: 404, headers: { "Cache-Control": "no-store" } })

    expect(response.status).toBe(404)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
})
