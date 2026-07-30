import { describe, expect, it } from "vitest"

import {
  clearCookieHeader,
  cookieHeader,
  type ImportedProfile,
  type ImportRequest,
  ImportLifetimeMillis,
  newNonce,
  readCookie,
  readProfile,
  readRequest,
  sealProfile,
  sealRequest,
  StateLifetimeMillis,
} from "./google-import.ts"

const SECRET = "GOCSPX-not-a-real-client-secret"
const NOW = Date.parse("2026-07-30T09:00:00.000Z")

const request: ImportRequest = {
  token: "23456789ABCD",
  language: "uk",
  mode: "popup",
  nonce: "vJ4kQpNq2Zx8",
}

const profile: ImportedProfile = {
  token: "23456789ABCD",
  sub: "104729384756102938475",
  name: "Олена Пшенична",
  email: "olena@example.com",
  emailVerified: true,
  pictureUrl: "https://lh3.googleusercontent.com/a/ACg8ocK=s256-c",
}

describe("the sealed state", () => {
  it("survives a round trip", async () => {
    const sealed = await sealRequest(SECRET, request, NOW)
    expect(await readRequest(SECRET, sealed, NOW)).toEqual(request)
  })

  /**
   * The cookie is `HttpOnly`, which stops a script reading it and does nothing
   * about the person holding the browser. Tampering has to be caught by the MAC.
   */
  it("refuses a payload that was edited", async () => {
    const sealed = await sealRequest(SECRET, request, NOW)
    const [payload, mac] = sealed.split(".")
    const forged = await sealRequest(SECRET, { ...request, token: "ZZZZZZZZZZZZ" }, NOW)
    expect(await readRequest(SECRET, `${forged.split(".")[0]}.${mac}`, NOW)).toBeUndefined()
    expect(await readRequest(SECRET, `${payload}.${"A".repeat(43)}`, NOW)).toBeUndefined()
  })

  it("refuses a seal made under another secret", async () => {
    const sealed = await sealRequest("another-secret", request, NOW)
    expect(await readRequest(SECRET, sealed, NOW)).toBeUndefined()
  })

  it("refuses one that has expired, and accepts one that has not", async () => {
    const sealed = await sealRequest(SECRET, request, NOW)
    expect(await readRequest(SECRET, sealed, NOW + StateLifetimeMillis - 1)).toEqual(request)
    expect(await readRequest(SECRET, sealed, NOW + StateLifetimeMillis + 1)).toBeUndefined()
  })

  it("refuses nonsense without raising", async () => {
    for (const value of [undefined, "", "no-dot", "a.b", "%%%.%%%"]) {
      expect(await readRequest(SECRET, value, NOW)).toBeUndefined()
    }
  })

  /** A payload that seals cleanly but is not the shape this cookie promises. */
  it("refuses a well-sealed payload of the wrong shape", async () => {
    const sealed = await sealProfile(SECRET, profile, NOW)
    expect(await readRequest(SECRET, sealed, NOW)).toBeUndefined()
  })
})

describe("the sealed profile", () => {
  it("survives a round trip, non-Latin names included", async () => {
    const sealed = await sealProfile(SECRET, profile, NOW)
    expect(await readProfile(SECRET, sealed, NOW)).toEqual(profile)
  })

  it("keeps the optional halves optional", async () => {
    const bare: ImportedProfile = { token: profile.token, sub: profile.sub, emailVerified: false }
    const sealed = await sealProfile(SECRET, bare, NOW)
    expect(await readProfile(SECRET, sealed, NOW)).toEqual(bare)
  })

  /**
   * The attestation is the whole reason this is sealed rather than sent through
   * the page: a `sub` the browser could choose would attest to nothing.
   */
  it("refuses a forged sub", async () => {
    const sealed = await sealProfile(SECRET, profile, NOW)
    const forged = await sealProfile(SECRET, { ...profile, sub: "1" }, NOW)
    expect(await readProfile(SECRET, `${forged.split(".")[0]}.${sealed.split(".")[1]}`, NOW)).toBe(
      undefined,
    )
  })

  it("outlives the consent gate but not the day", async () => {
    const sealed = await sealProfile(SECRET, profile, NOW)
    expect(await readProfile(SECRET, sealed, NOW + ImportLifetimeMillis - 1)).toEqual(profile)
    expect(await readProfile(SECRET, sealed, NOW + ImportLifetimeMillis + 1)).toBeUndefined()
  })

  it("refuses a state cookie presented as a profile", async () => {
    const sealed = await sealRequest(SECRET, request, NOW)
    expect(await readProfile(SECRET, sealed, NOW)).toBeUndefined()
  })
})

describe("the nonce", () => {
  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 64 }, () => newNonce()))
    expect(seen.size).toBe(64)
    for (const nonce of seen) expect(nonce).toMatch(/^[A-Za-z0-9_-]{16,}$/)
  })
})

describe("the cookie header", () => {
  it("carries the flags that make the cookie survive Google's return", () => {
    const header = cookieHeader("praximo_g_state", "sealed", {
      secure: true,
      maxAgeMillis: StateLifetimeMillis,
    })
    expect(header).toContain("praximo_g_state=sealed")
    expect(header).toContain("HttpOnly")
    expect(header).toContain("Secure")
    // `Lax`, never `Strict`: the callback is a cross-site top-level navigation
    // from Google, and `Strict` would withhold the cookie exactly there.
    expect(header).toContain("SameSite=Lax")
    expect(header).toContain("Path=/")
    expect(header).toContain(`Max-Age=${StateLifetimeMillis / 1000}`)
  })

  /** Safari refuses `Secure` over plain http, and local development is plain http. */
  it("drops Secure when the request was not", () => {
    const header = cookieHeader("praximo_g_state", "sealed", {
      secure: false,
      maxAgeMillis: StateLifetimeMillis,
    })
    expect(header).not.toContain("Secure")
    expect(header).toContain("HttpOnly")
  })

  it("clears with an expiry in the past and an empty value", () => {
    const header = clearCookieHeader("praximo_g_import", { secure: true })
    expect(header).toContain("praximo_g_import=;")
    expect(header).toContain("Max-Age=0")
  })
})

describe("reading a cookie back off a request", () => {
  it("finds the one it was asked for", () => {
    const header = "theme=dark; praximo_g_import=abc.def; other=1"
    expect(readCookie(header, "praximo_g_import")).toBe("abc.def")
    expect(readCookie(header, "theme")).toBe("dark")
  })

  it("answers for a request that carried none", () => {
    expect(readCookie(undefined, "praximo_g_import")).toBeUndefined()
    expect(readCookie("", "praximo_g_import")).toBeUndefined()
    expect(readCookie("theme=dark", "praximo_g_import")).toBeUndefined()
  })

  /** A name that is a suffix of another must not match it. */
  it("does not match a longer name ending in the one asked for", () => {
    expect(readCookie("not_praximo_g_import=abc", "praximo_g_import")).toBeUndefined()
  })
})
