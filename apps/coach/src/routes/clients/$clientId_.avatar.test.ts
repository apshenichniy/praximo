import { avatarRefusal } from "@praximo/storage"
import { describe, expect, it } from "vitest"

import { CoachSession } from "@/server/coach-session.ts"
import { avatarResponse, refusalStatus } from "./$clientId_.avatar.ts"

/**
 * The two decisions this route makes on its own (#231): what a failure becomes, and
 * how a described response is built.
 *
 * Everything else — the authorisation, the workspace scope, the caching — belongs to
 * `CoachAvatars` and `AvatarReader` and is asserted there.
 */

describe("refusalStatus", () => {
  it("answers 401 for the undifferentiated refusal every read here shares", () => {
    expect(refusalStatus(new CoachSession.Unauthenticated())).toBe(401)
  })

  it("answers 503 when the database could not say, rather than claiming no photo", () => {
    // The distinction that matters: a `no-store` 404 would be cached as "this
    // client has no face" for the rest of the page's life.
    expect(
      refusalStatus(new CoachSession.LoadFailed({ operation: "AvatarRepo.clientAvatarKey" })),
    ).toBe(503)
  })

  it("treats anything it does not recognise as a server problem", () => {
    expect(refusalStatus(new Error("something else"))).toBe(503)
    expect(refusalStatus(undefined)).toBe(503)
  })
})

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
    // `Response` refuses a body on a 304, so the branch that saves the coach a
    // download is also the only branch that can throw.
    const response = avatarResponse({
      status: 304,
      headers: { ETag: '"1a2b3c"', "Cache-Control": "private, max-age=0, must-revalidate" },
    })

    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
    expect(response.headers.get("etag")).toBe('"1a2b3c"')
  })

  it("builds a refusal the storage package described", () => {
    const response = avatarResponse(avatarRefusal(401))

    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
})
