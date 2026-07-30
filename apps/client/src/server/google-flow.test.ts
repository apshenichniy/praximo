import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as TestClock from "effect/testing/TestClock"

import { finishImport, startImport } from "./google-flow.ts"
import { GoogleIdentity } from "./google-identity.ts"
import { StateLifetimeMillis } from "./google-import.ts"

/**
 * The two `/auth/google/*` decisions (#59), and they are mostly about refusals.
 *
 * The happy path needs Google on the other end and is the ticket's live
 * verification. What a suite holds is that nothing reaches Google without a
 * shaped token, that a callback without a matching state is not a flow anybody
 * started, and that no branch of either can put an error screen in front of a
 * client who was handed this link by their coach.
 */

const ORIGIN = "https://me.praximo.io"
const LOCAL = "http://localhost:3003"
const TOKEN = "23456789ABCD"
const NOW = Date.parse("2026-07-30T09:00:00.000Z")

const SETTINGS: GoogleIdentity.Settings = {
  clientId: "1234.apps.googleusercontent.com",
  clientSecret: "GOCSPX-not-a-real-client-secret",
  origins: [ORIGIN, LOCAL],
}

const PROFILE = {
  sub: "104729384756102938475",
  name: "Олена Пшенична",
  email: "olena@example.com",
  email_verified: true,
  picture: "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c",
}

const transport = (
  answers: Readonly<Record<string, { readonly status: number; readonly body: unknown }>>,
) => {
  const calls: Array<string> = []
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const answer = Object.entries(answers).find(([prefix]) => url.startsWith(prefix))?.[1]
    if (answer === undefined) return new Response("not scripted", { status: 502 })
    return Response.json(answer.body, { status: answer.status })
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

const google = () =>
  transport({
    "https://oauth2.googleapis.com/token": { status: 200, body: { access_token: "ya29.a0" } },
    "https://openidconnect.googleapis.com/v1/userinfo": { status: 200, body: PROFILE },
  })

/**
 * No default on `settings`: a parameter that legitimately takes `undefined` — a
 * stage with no OAuth client — must not have one, or passing it explicitly
 * silently gets the default back and the test asserts nothing.
 */
const runWith = <A, E>(
  effect: Effect.Effect<A, E, GoogleIdentity.Service>,
  net: ReturnType<typeof google>,
  settings: GoogleIdentity.Settings | undefined,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW)
    return yield* effect.pipe(Effect.provide(GoogleIdentity.layerFor(settings, net.fetch)))
  })

const run = <A, E>(effect: Effect.Effect<A, E, GoogleIdentity.Service>, net = google()) =>
  runWith(effect, net, SETTINGS)

/** A stage with no OAuth client at all — no id, no secret, no origins. */
const runUnconfigured = <A, E>(effect: Effect.Effect<A, E, GoogleIdentity.Service>) =>
  runWith(effect, google(), undefined)

/** The `Set-Cookie` values a response carries, joined for coarse assertions. */
const cookies = (response: Response): string => response.headers.getSetCookie().join(" || ")

/** One press, all the way to the redirect, as the callback's fixtures need it. */
const started = (search: string, net = google()) =>
  run(startImport({ url: new URL(`${ORIGIN}/auth/google/start?${search}`), throttled: false }), net)

const stateOf = (response: Response) => ({
  cookie: (response.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "",
  nonce: new URL(response.headers.get("location") ?? "").searchParams.get("state") ?? "",
})

describe("starting an import", () => {
  it.effect("refuses a token this product never issued, without minting anything", () =>
    Effect.gen(function* () {
      for (const token of ["", "short", "lowercase1234", "../../etc/passwd"]) {
        const net = google()
        const response = yield* started(`token=${encodeURIComponent(token)}`, net)
        expect(response.status).toBe(404)
        expect(response.headers.getSetCookie()).toEqual([])
        expect(net.calls).toEqual([])
      }
    }),
  )

  it.effect("asks Google for the three scopes and nothing else", () =>
    Effect.gen(function* () {
      const response = yield* started(`token=${TOKEN}&lang=ru`)

      expect(response.status).toBe(302)
      const authorize = new URL(response.headers.get("location") ?? "")
      expect(authorize.origin).toBe("https://accounts.google.com")
      expect(authorize.searchParams.get("scope")).toBe("openid profile email")
      expect(authorize.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/google/callback`)
      // No refresh token is ever requested: there is nothing to come back for.
      expect(authorize.searchParams.get("access_type")).toBeNull()

      const cookie = cookies(response)
      expect(cookie).toContain("praximo_g_state=")
      expect(cookie).toContain("HttpOnly")
      // Google returns the client by a cross-site top-level navigation, which
      // `SameSite=Strict` would withhold the cookie on.
      expect(cookie).toContain("SameSite=Lax")
      expect(cookie).toContain("Secure")
    }),
  )

  /** Safari refuses a `Secure` cookie over plain http, and local dev is plain http. */
  it.effect("drops Secure on the origin local development runs on", () =>
    Effect.gen(function* () {
      const response = yield* run(
        startImport({
          url: new URL(`${LOCAL}/auth/google/start?token=${TOKEN}`),
          throttled: false,
        }),
      )
      expect(cookies(response)).not.toContain("Secure")
    }),
  )

  it.effect("mints a fresh state on every press", () =>
    Effect.gen(function* () {
      const first = stateOf(yield* started(`token=${TOKEN}`))
      const second = stateOf(yield* started(`token=${TOKEN}`))
      expect(first.nonce).not.toBe(second.nonce)
      expect(first.cookie).not.toBe(second.cookie)
    }),
  )

  it.effect("returns a spent allowance to the form rather than to Google", () =>
    Effect.gen(function* () {
      const net = google()
      const response = yield* run(
        startImport({
          url: new URL(`${ORIGIN}/auth/google/start?token=${TOKEN}&mode=redirect&lang=uk`),
          throttled: true,
        }),
        net,
      )

      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe(`/i/${TOKEN}?lang=uk&g=0`)
      expect(net.calls).toEqual([])
    }),
  )

  it.effect("returns an unregistered origin to the form, in the shape it came in", () =>
    Effect.gen(function* () {
      const popup = yield* run(
        startImport({
          url: new URL(`https://client-dev.workers.dev/auth/google/start?token=${TOKEN}`),
          throttled: false,
        }),
      )
      const fallback = yield* run(
        startImport({
          url: new URL(
            `https://client-dev.workers.dev/auth/google/start?token=${TOKEN}&mode=redirect&lang=ru`,
          ),
          throttled: false,
        }),
      )

      // A page served from there would not have drawn a button at all; a
      // hand-typed URL gets the form back rather than Google's mismatch screen.
      expect(popup.headers.get("content-type")).toContain("text/html")
      expect(fallback.headers.get("location")).toBe(`/i/${TOKEN}?lang=ru&g=0`)
      // `g=0`, not `g=1`: the client came back empty-handed, and the page says so
      // without spending a request to be told nothing happened.
      expect(fallback.headers.get("location")).not.toContain("g=1")
    }),
  )

  it.effect("has no button to honour on a stage with no OAuth client", () =>
    Effect.gen(function* () {
      const response = yield* runUnconfigured(
        startImport({
          url: new URL(`${ORIGIN}/auth/google/start?token=${TOKEN}&mode=redirect`),
          throttled: false,
        }),
      )
      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe(`/i/${TOKEN}?lang=en&g=0`)
    }),
  )
})

describe("finishing an import", () => {
  const callback = (search: string, cookie: string | null, net = google()) =>
    run(finishImport({ url: new URL(`${ORIGIN}/auth/google/callback?${search}`), cookie }), net)

  it.effect("says nothing at all to a callback nobody started", () =>
    Effect.gen(function* () {
      for (const cookie of [null, "", "theme=dark", "praximo_g_state=forged.payload"]) {
        const net = google()
        const response = yield* callback("code=4/0Ab&state=n", cookie, net)
        // There is no invitation to return anyone to, so there is no page and no
        // explanation — and no code is exchanged for one.
        expect(response.status).toBe(400)
        expect(net.calls).toEqual([])
      }
    }),
  )

  it.effect("refuses a state that expired while the client sat on Google's screen", () =>
    Effect.gen(function* () {
      const { cookie, nonce } = stateOf(yield* started(`token=${TOKEN}`))
      const response = yield* Effect.gen(function* () {
        yield* TestClock.setTime(NOW + StateLifetimeMillis + 1)
        return yield* finishImport({
          url: new URL(`${ORIGIN}/auth/google/callback?code=4/0Ab&state=${nonce}`),
          cookie,
        }).pipe(Effect.provide(GoogleIdentity.layerFor(SETTINGS, google().fetch)))
      })
      expect(response.status).toBe(400)
    }),
  )

  it.effect("returns the client to the form when the echoed state does not match", () =>
    Effect.gen(function* () {
      const { cookie } = stateOf(yield* started(`token=${TOKEN}&mode=redirect&lang=ru`))
      const net = google()
      const response = yield* callback("code=4/0Ab&state=not-the-nonce", cookie, net)

      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe(`/i/${TOKEN}?lang=ru&g=0`)
      expect(net.calls).toEqual([])
      // Spent whatever happened to it: a state left behind is a nonce that could
      // be presented a second time.
      expect(cookies(response)).toContain("praximo_g_state=;")
    }),
  )

  it.effect("takes a declined consent screen quietly back to the form", () =>
    Effect.gen(function* () {
      const { cookie, nonce } = stateOf(yield* started(`token=${TOKEN}&mode=redirect&lang=uk`))
      const net = google()
      const response = yield* callback(`error=access_denied&state=${nonce}`, cookie, net)

      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe(`/i/${TOKEN}?lang=uk&g=0`)
      expect(net.calls).toEqual([])
      expect(cookies(response)).not.toContain("praximo_g_import=")
    }),
  )

  it.effect("ends a declined popup on a document that closes itself", () =>
    Effect.gen(function* () {
      const { cookie, nonce } = stateOf(yield* started(`token=${TOKEN}&lang=ru`))
      const response = yield* callback(`error=access_denied&state=${nonce}`, cookie)
      const html = yield* Effect.promise(() => response.text())

      expect(response.status).toBe(200)
      expect(html).toContain("window.close()")
      expect(html).toContain('"praximo.google-import"')
      expect(html).toContain("ok: false")
      // Addressed to this origin, and carrying nothing about anybody.
      expect(html).toContain("window.location.origin")
      expect(html).not.toContain("@")
      expect(html).toContain(`lang="ru"`)
    }),
  )

  it.effect("hands a completed import back as a sealed cookie and a bare signal", () =>
    Effect.gen(function* () {
      const { cookie, nonce } = stateOf(yield* started(`token=${TOKEN}&lang=uk`))
      const response = yield* callback(`code=4/0Ab&state=${nonce}`, cookie)
      const html = yield* Effect.promise(() => response.text())

      expect(response.status).toBe(200)
      expect(html).toContain("ok: true")
      // The signal carries no profile at all — not the name, not the address, and
      // above all not the attestation.
      expect(html).not.toContain(PROFILE.email)
      expect(html).not.toContain(PROFILE.name)
      expect(html).not.toContain(PROFILE.sub)

      const set = cookies(response)
      expect(set).toContain("praximo_g_import=")
      expect(set).toContain("HttpOnly")
      // The state is spent on the way out, always.
      expect(set).toContain("praximo_g_state=;")
    }),
  )

  it.effect("carries a completed fallback back with the flag that says to read it", () =>
    Effect.gen(function* () {
      const { cookie, nonce } = stateOf(yield* started(`token=${TOKEN}&mode=redirect&lang=uk`))
      const response = yield* callback(`code=4/0Ab&state=${nonce}`, cookie)

      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe(`/i/${TOKEN}?lang=uk&g=1`)
      // No personal data in the URL, ever: the flag says an import is waiting,
      // and the page asks the server what it was.
      expect(response.headers.get("location")).not.toContain("@")
      expect(cookies(response)).toContain("praximo_g_import=")
    }),
  )

  it.effect("returns the client to the form when the exchange will not complete", () =>
    Effect.gen(function* () {
      const { cookie, nonce } = stateOf(yield* started(`token=${TOKEN}&mode=redirect&lang=en`))
      const response = yield* callback(
        `code=spent&state=${nonce}`,
        cookie,
        transport({
          "https://oauth2.googleapis.com/token": { status: 400, body: { error: "invalid_grant" } },
        }),
      )

      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe(`/i/${TOKEN}?lang=en&g=0`)
      expect(cookies(response)).not.toContain("praximo_g_import=")
    }),
  )
})
