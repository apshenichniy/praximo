import "@tanstack/react-start/server-only"

import { ClientInviteTokenPattern, narrowCoachLanguage } from "@praximo/domain"
import { Clock, Effect } from "effect"

import { GoogleIdentity } from "./google-identity.ts"
import { newNonce, readCookie, StateCookie } from "./google-import.ts"
import { isSecure, readMode, refuse, returnToPage, toGoogle } from "./google-return.ts"

/**
 * The two decisions the `/auth/google/*` routes make (#59), with nothing of the
 * Worker's wiring in them.
 *
 * They live here rather than in the route files for the reason every seam in this
 * app does: a route file reaches `runtime.server.ts`, which reaches
 * `cloudflare:workers`, which does not exist in Node — so a rule kept there is a
 * rule no suite can hold. What is left in the routes is parsing a `Request` and
 * spending a rate limit; everything worth asserting is below.
 */

/**
 * Where the client is sent when they press the button.
 *
 * `throttled` is decided by the caller, which is the only party holding the
 * binding, and a spent allowance is answered exactly as an unconfigured stage is:
 * back to the form, saying nothing. The two are indistinguishable on purpose —
 * neither is something the client can act on, and both leave the fields they were
 * filling in exactly as they were.
 */
export const startImport = Effect.fn("GoogleFlow.startImport")(function* (input: {
  readonly url: URL
  readonly throttled: boolean
}) {
  const { url } = input
  const token = url.searchParams.get("token") ?? ""
  // Shape-checked before anything else, as every other route here checks it: a
  // path a random crawler invented never becomes a redirect this Worker signed.
  if (!ClientInviteTokenPattern.test(token)) return refuse(404)

  const language = narrowCoachLanguage(url.searchParams.get("lang") ?? undefined)
  const mode = readMode(url.searchParams.get("mode"))
  const secure = isSecure(url)
  const empty = { token, language, mode, secure, ok: false } as const
  if (input.throttled) return returnToPage(empty)

  const now = yield* Clock.currentTimeMillis
  const nonce = newNonce()
  const google = yield* GoogleIdentity.Service
  const started = yield* Effect.gen(function* () {
    // Ahead of the seal, so an unregistered origin or an unconfigured stage costs
    // no cookie: there would be nothing to come back to.
    const authorize = yield* google.authorizeUrl({ origin: url.origin, state: nonce })
    const state = yield* google.sealState({ token, language, mode, nonce }, now)
    return { authorize, state }
  }).pipe(Effect.orElseSucceed(() => undefined))

  // Unconfigured, or an origin Google has not been told about. The page would not
  // have drawn a button at all, so this is a hand-typed URL or a stage that
  // changed under an open tab — and the answer to both is the form they left.
  if (started === undefined) return returnToPage(empty)

  return toGoogle({ authorize: started.authorize, state: started.state, secure })
})

/**
 * What Google's return means, and where it leaves the client.
 *
 * **The `state` check is a double submit**: Google echoes back a nonce this Worker
 * minted, and the cookie holding the same nonce is one only this origin could have
 * set. A callback arriving without both is not a flow anybody here started.
 *
 * Nothing on this path can produce an error screen. A declined consent, a spent
 * code, a `userinfo` that would not answer — all end on the same page with the
 * same fields, because the manual ones were always the way through and the import
 * is a convenience on top of them.
 */
export const finishImport = Effect.fn("GoogleFlow.finishImport")(function* (input: {
  readonly url: URL
  readonly cookie: string | null
}) {
  const { url } = input
  const secure = isSecure(url)
  const now = yield* Clock.currentTimeMillis
  const google = yield* GoogleIdentity.Service

  const state = yield* google.readState(readCookie(input.cookie, StateCookie), now)
  // No state at all: an expired one, a forged one, a stage with no OAuth client,
  // or somebody who opened this address by hand. There is no invitation to return
  // anyone to, so nothing is said and nothing is offered.
  if (state === undefined) return refuse(400)

  const { token, language, mode } = state
  const empty = { token, language, mode, secure, ok: false } as const
  if (url.searchParams.get("state") !== state.nonce) return returnToPage(empty)

  const code = url.searchParams.get("code")
  // `error=access_denied` is a client who looked at the consent screen and decided
  // not to — the most ordinary outcome this route has, and not a fault.
  if (code === null || url.searchParams.get("error") !== null) return returnToPage(empty)

  const sealed = yield* Effect.gen(function* () {
    const profile = yield* google.profileForCode({ code, origin: url.origin })
    // Sealed against the token this flow started on, so an import cannot be
    // carried to another invitation open in another tab.
    return yield* google.sealImport(
      {
        token,
        sub: profile.sub,
        emailVerified: profile.emailVerified,
        ...(profile.name === undefined ? {} : { name: profile.name }),
        ...(profile.email === undefined ? {} : { email: profile.email }),
        ...(profile.pictureUrl === undefined ? {} : { pictureUrl: profile.pictureUrl }),
      },
      now,
    )
  }).pipe(Effect.orElseSucceed(() => undefined))

  if (sealed === undefined) return returnToPage(empty)
  return returnToPage({ token, language, mode, secure, ok: true, sealed })
})
