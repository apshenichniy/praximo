import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { GoogleIdentity, googlePictureUrl } from "./google-identity.ts"

const SETTINGS = {
  clientId: "1234.apps.googleusercontent.com",
  clientSecret: "GOCSPX-not-a-real-client-secret",
  origins: ["https://me.praximo.io", "http://localhost:3003"],
} as const

const ORIGIN = "https://me.praximo.io"
const REDIRECT = `${ORIGIN}/auth/google/callback`

interface Call {
  readonly url: string
  readonly body: string
}

/**
 * A transport that answers each endpoint from a script and records what it was
 * asked — which is where the assertions about `redirect_uri`, the grant type and
 * the discarded token actually live.
 */
const transport = (
  answers: Readonly<Record<string, { readonly status: number; readonly body: unknown }>>,
) => {
  const calls: Array<Call> = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: String(init?.body ?? "") })
    const answer = Object.entries(answers).find(([prefix]) => url.startsWith(prefix))?.[1]
    if (answer === undefined) return new Response("not scripted", { status: 502 })
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    })
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

const TOKEN_ANSWER = { status: 200, body: { access_token: "ya29.a0-not-real", expires_in: 3599 } }
const PROFILE_ANSWER = {
  status: 200,
  body: {
    sub: "104729384756102938475",
    name: "Олена Пшенична",
    email: "olena@example.com",
    email_verified: true,
    picture: "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c",
  },
}

const happy = () =>
  transport({
    "https://oauth2.googleapis.com/token": TOKEN_ANSWER,
    "https://openidconnect.googleapis.com/v1/userinfo": PROFILE_ANSWER,
  })

const runWith = <A, E>(
  effect: Effect.Effect<A, E, GoogleIdentity.Service>,
  fetch: typeof globalThis.fetch,
  settings: GoogleIdentity.Settings | undefined,
) => effect.pipe(Effect.provide(GoogleIdentity.layerFor(settings, fetch)))

const run = <A, E>(
  effect: Effect.Effect<A, E, GoogleIdentity.Service>,
  fetch: typeof globalThis.fetch,
) => runWith(effect, fetch, SETTINGS)

/** A stage with no OAuth client at all — no id, no secret, no origins. */
const runUnconfigured = <A, E>(
  effect: Effect.Effect<A, E, GoogleIdentity.Service>,
  fetch: typeof globalThis.fetch,
) => runWith(effect, fetch, undefined)

describe("where the button may be offered", () => {
  it.effect("is offered from a registered origin and nowhere else", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      expect(google.offeredAt(ORIGIN)).toBe(true)
      expect(google.offeredAt("http://localhost:3003")).toBe(true)
      // An origin Google has not been told about would answer the client with
      // `redirect_uri_mismatch`; no button at all is the honest surface.
      expect(google.offeredAt("https://client-dev.workers.dev")).toBe(false)
    }).pipe((effect) => run(effect, happy().fetch)),
  )

  it.effect("is offered nowhere at all when the stage has no client", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      expect(google.offeredAt(ORIGIN)).toBe(false)
    }).pipe((effect) => runUnconfigured(effect, happy().fetch)),
  )

  /**
   * Half a credential draws a button that cannot complete a step of the flow —
   * the dead control this page refuses to ship, wearing a working one's clothes.
   */
  it.effect("is not offered on an id with no secret behind it", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      expect(google.offeredAt(ORIGIN)).toBe(false)
    }).pipe((effect) => runWith(effect, happy().fetch, { ...SETTINGS, clientSecret: "" })),
  )
})

describe("the authorization URL", () => {
  it.effect("asks for the three scopes and nothing else", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      const url = new URL(yield* google.authorizeUrl({ origin: ORIGIN, state: "nonce-1" }))

      expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
      expect(url.searchParams.get("scope")).toBe("openid profile email")
      expect(url.searchParams.get("response_type")).toBe("code")
      expect(url.searchParams.get("client_id")).toBe(SETTINGS.clientId)
      expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT)
      expect(url.searchParams.get("state")).toBe("nonce-1")
      // No refresh token is ever requested: there is nothing to come back for.
      expect(url.searchParams.get("access_type")).toBeNull()
      expect(url.searchParams.get("prompt")).toBe("select_account")
    }).pipe((effect) => run(effect, happy().fetch)),
  )

  it.effect("refuses an origin that is not registered, and a stage with no client", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      const refusal = yield* google
        .authorizeUrl({ origin: "https://elsewhere.example", state: "n" })
        .pipe(Effect.flip)
      expect(refusal.reason).toBe("unknown-origin")
    }).pipe((effect) => run(effect, happy().fetch)),
  )

  it.effect("refuses when the stage has no client at all", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      const refusal = yield* google.authorizeUrl({ origin: ORIGIN, state: "n" }).pipe(Effect.flip)
      expect(refusal.reason).toBe("unconfigured")
    }).pipe((effect) => runUnconfigured(effect, happy().fetch)),
  )
})

describe("the profile behind a code", () => {
  it.effect("exchanges the code and reads the profile from userinfo", () =>
    Effect.gen(function* () {
      const scripted = happy()
      const profile = yield* Effect.gen(function* () {
        const google = yield* GoogleIdentity.Service
        return yield* google.profileForCode({ code: "4/0Ab-code", origin: ORIGIN })
      }).pipe((effect) => run(effect, scripted.fetch))

      expect(profile).toEqual({
        sub: "104729384756102938475",
        name: "Олена Пшенична",
        email: "olena@example.com",
        emailVerified: true,
        // Normalised away from Google's 96px default: an avatar is stored once
        // and shown at whatever size a surface wants.
        pictureUrl: "https://lh3.googleusercontent.com/a/ACg8ocK=s256-c",
      })

      const exchange = scripted.calls[0]
      expect(exchange?.url).toBe("https://oauth2.googleapis.com/token")
      expect(exchange?.body).toContain("grant_type=authorization_code")
      expect(exchange?.body).toContain(`redirect_uri=${encodeURIComponent(REDIRECT)}`)
      expect(scripted.calls[1]?.url).toBe("https://openidconnect.googleapis.com/v1/userinfo")
    }),
  )

  /**
   * The access token is spent inside this module and returned by nothing. A
   * token that reaches a caller is a token that exists somewhere, and the
   * privacy policy says none does.
   */
  it.effect("returns nothing resembling a token", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      const profile = yield* google.profileForCode({ code: "4/0Ab-code", origin: ORIGIN })
      expect(JSON.stringify(profile)).not.toContain("ya29")
    }).pipe((effect) => run(effect, happy().fetch)),
  )

  it.effect("reads email_verified rather than assuming it", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      const profile = yield* google.profileForCode({ code: "c", origin: ORIGIN })
      expect(profile.emailVerified).toBe(false)
      expect(profile.email).toBe("olena@example.com")
    }).pipe((effect) =>
      run(
        effect,
        transport({
          "https://oauth2.googleapis.com/token": TOKEN_ANSWER,
          "https://openidconnect.googleapis.com/v1/userinfo": {
            status: 200,
            body: { ...PROFILE_ANSWER.body, email_verified: false },
          },
        }).fetch,
      ),
    ),
  )

  it.effect("survives a profile with neither name nor picture", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      const profile = yield* google.profileForCode({ code: "c", origin: ORIGIN })
      expect(profile).toEqual({ sub: "104729384756102938475", emailVerified: false })
    }).pipe((effect) =>
      run(
        effect,
        transport({
          "https://oauth2.googleapis.com/token": TOKEN_ANSWER,
          "https://openidconnect.googleapis.com/v1/userinfo": {
            status: 200,
            body: { sub: "104729384756102938475" },
          },
        }).fetch,
      ),
    ),
  )

  /** A picture from anywhere but Google is not a picture this Worker will fetch. */
  it.effect("drops a picture that is not Google's", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      const profile = yield* google.profileForCode({ code: "c", origin: ORIGIN })
      expect(profile.pictureUrl).toBeUndefined()
    }).pipe((effect) =>
      run(
        effect,
        transport({
          "https://oauth2.googleapis.com/token": TOKEN_ANSWER,
          "https://openidconnect.googleapis.com/v1/userinfo": {
            status: 200,
            body: { ...PROFILE_ANSWER.body, picture: "http://169.254.169.254/latest/meta-data/" },
          },
        }).fetch,
      ),
    ),
  )

  it.effect("refuses an exchange the token endpoint would not honour", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      const refusal = yield* google
        .profileForCode({ code: "spent", origin: ORIGIN })
        .pipe(Effect.flip)
      expect(refusal.reason).toBe("exchange-failed")
    }).pipe((effect) =>
      run(
        effect,
        transport({
          "https://oauth2.googleapis.com/token": {
            status: 400,
            body: { error: "invalid_grant" },
          },
        }).fetch,
      ),
    ),
  )

  it.effect("refuses when userinfo will not answer", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      const refusal = yield* google.profileForCode({ code: "c", origin: ORIGIN }).pipe(Effect.flip)
      expect(refusal.reason).toBe("profile-failed")
    }).pipe((effect) =>
      run(
        effect,
        transport({
          "https://oauth2.googleapis.com/token": TOKEN_ANSWER,
          "https://openidconnect.googleapis.com/v1/userinfo": { status: 401, body: {} },
        }).fetch,
      ),
    ),
  )

  it.effect("refuses a profile with no sub, which is the one field Google guarantees", () =>
    Effect.gen(function* () {
      const google = yield* GoogleIdentity.Service
      const refusal = yield* google.profileForCode({ code: "c", origin: ORIGIN }).pipe(Effect.flip)
      expect(refusal.reason).toBe("profile-failed")
    }).pipe((effect) =>
      run(
        effect,
        transport({
          "https://oauth2.googleapis.com/token": TOKEN_ANSWER,
          "https://openidconnect.googleapis.com/v1/userinfo": {
            status: 200,
            body: { name: "Nobody" },
          },
        }).fetch,
      ),
    ),
  )

  it.effect("never reaches Google from an unregistered origin", () =>
    Effect.gen(function* () {
      const scripted = happy()
      const refusal = yield* Effect.gen(function* () {
        const google = yield* GoogleIdentity.Service
        return yield* google.profileForCode({ code: "c", origin: "https://elsewhere.example" })
      }).pipe((effect) => run(effect, scripted.fetch), Effect.flip)
      expect(refusal.reason).toBe("unknown-origin")
      expect(scripted.calls).toEqual([])
    }),
  )
})

describe("the picture URL", () => {
  it("accepts Google's own host and normalises the size", () => {
    expect(googlePictureUrl("https://lh3.googleusercontent.com/a/ACg8ocK=s96-c")).toBe(
      "https://lh3.googleusercontent.com/a/ACg8ocK=s256-c",
    )
    expect(googlePictureUrl("https://lh3.googleusercontent.com/a/ACg8ocK")).toBe(
      "https://lh3.googleusercontent.com/a/ACg8ocK=s256-c",
    )
  })

  it("refuses anything that is not Google's, over any scheme", () => {
    for (const value of [
      "http://lh3.googleusercontent.com/a/x",
      "https://evil.example/a/x",
      "https://googleusercontent.com.evil.example/a/x",
      "file:///etc/passwd",
      "not a url",
      "",
    ]) {
      expect(googlePictureUrl(value)).toBeUndefined()
    }
  })

  /** A URL carrying a query is left exactly as it is rather than corrupted. */
  it("leaves a URL with a query alone", () => {
    const value = "https://lh3.googleusercontent.com/a/ACg8ocK?sz=50"
    expect(googlePictureUrl(value)).toBe(value)
  })
})
