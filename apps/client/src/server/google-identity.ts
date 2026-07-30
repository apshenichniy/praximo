import "@tanstack/react-start/server-only"

import { Config, Context, Effect, Layer, Redacted, Schema } from "effect"

import {
  type ImportedProfile,
  type ImportRequest,
  readProfile,
  readRequest,
  sealProfile,
  sealRequest,
  text,
} from "./google-import.ts"

/**
 * The Google half of the profile import (#59): where the client is sent, what
 * comes back, and nothing about invitations or pages.
 *
 * **We draw the button ourselves and this is the other half of that decision.**
 * Google Identity Services would have handled the flow — and would have loaded a
 * script and talked to Google before the client touched anything, on a page
 * whose whole promise is that nothing has been saved yet. So the page stays
 * inert until the press, and an ordinary OAuth 2.0 code flow runs here instead.
 *
 * Three properties are asserted by this module's own suite because nothing else
 * can assert them:
 *
 * - **Scopes are `openid profile email` and nothing else**, and `access_type` is
 *   left at its default, so no refresh token is ever issued to ask for.
 * - **The profile is read from `userinfo`, not from the ID token.** `sub` is
 *   guaranteed there; `name` and `picture` are not (#28). The ID token is not
 *   parsed at all — the code came back over TLS from Google to a redirect URI
 *   only Google knows, and the profile is fetched from Google directly.
 * - **The access token never leaves.** It is spent on one `userinfo` read inside
 *   `profileForCode` and returned by nothing, which is what the privacy policy's
 *   "we do not keep the Google access token" means in code.
 */

const AuthorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth"
const TokenEndpoint = "https://oauth2.googleapis.com/token"
const ProfileEndpoint = "https://openidconnect.googleapis.com/v1/userinfo"

/** Everything the import asks for, and it is the whole of the consent screen. */
const Scopes = "openid profile email"

/**
 * The size an imported avatar is stored at.
 *
 * Google hands out `=s96-c` by default, which is a 96-pixel square and visibly
 * soft on a retina roster. The object is stored once and displayed wherever a
 * surface wants it, so it is taken at a size that covers every one of them.
 */
const PictureSize = 256

/** Where this Worker may offer the button, and what it signs in as when it does. */
export interface Settings {
  readonly clientId: string
  readonly clientSecret: string
  /** Exactly the origins registered with Google; see {@link offeredFrom}. */
  readonly origins: ReadonlyArray<string>
}

/** What one import learned. No token, and nothing the caller did not ask for. */
export interface GoogleProfile {
  readonly sub: string
  readonly name?: string
  readonly email?: string
  /** Read rather than assumed: `false` when a non-Google domain is attached (#28). */
  readonly emailVerified: boolean
  /** Present only when Google offered one *and* it is Google's to offer. */
  readonly pictureUrl?: string
}

/**
 * Why an import did not happen.
 *
 * One error with a `reason` rather than four, as `AvatarRejected` is: every
 * caller treats the whole set identically — return the client to the form with
 * everything they typed — and only the log cares which. No payload, ever: a
 * cause here would carry a code, a token or a URL that has one in it.
 */
export class ImportRefused extends Schema.TaggedErrorClass<ImportRefused>()(
  "GoogleIdentity.Refused",
  {
    reason: Schema.Literals([
      /** This stage has no OAuth client, so there is no button to press. */
      "unconfigured",
      /** A request from an origin Google has not been told about. */
      "unknown-origin",
      "exchange-failed",
      "profile-failed",
    ]),
  },
) {}

export interface Interface {
  /**
   * Whether the button may be drawn for a page served from this origin.
   *
   * Redirect URIs are exact-match at Google, so an origin that is not registered
   * would send the client to `redirect_uri_mismatch` — an error screen on a page
   * they were handed by their coach. No button is the honest answer, and it is
   * the same answer a stage with no OAuth client at all gives.
   */
  readonly offeredAt: (origin: string) => boolean
  readonly authorizeUrl: (input: {
    readonly origin: string
    readonly state: string
  }) => Effect.Effect<string, ImportRefused>
  /**
   * The code exchanged and the profile read, as one operation.
   *
   * Deliberately not two: an access token that could be held by a caller is a
   * token that exists outside the few lines that spend it, and the whole of this
   * design is that none does.
   */
  readonly profileForCode: (input: {
    readonly code: string
    readonly origin: string
  }) => Effect.Effect<GoogleProfile, ImportRefused>
  /**
   * The two cookies, sealed and read **here** rather than by their callers.
   *
   * The MAC key is derived from the client secret, and this is the module that
   * holds it. Handing the secret out so a route could seal with it would put a
   * credential on an interface to save four methods — and the four methods are
   * the cheaper half of that trade.
   */
  readonly sealState: (request: ImportRequest, now: number) => Effect.Effect<string, ImportRefused>
  readonly readState: (
    sealed: string | undefined,
    now: number,
  ) => Effect.Effect<ImportRequest | undefined>
  readonly sealImport: (
    profile: ImportedProfile,
    now: number,
  ) => Effect.Effect<string, ImportRefused>
  readonly readImport: (
    sealed: string | undefined,
    now: number,
  ) => Effect.Effect<ImportedProfile | undefined>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/client/GoogleIdentity",
) {}

/**
 * A picture URL this Worker is willing to fetch, at the size it wants it.
 *
 * **The host check is the point.** The URL arrives from Google and is sealed
 * into a cookie the page cannot write, so nothing untrusted should reach here —
 * and it is checked anyway, because the alternative is a server-side `fetch` to
 * an address whose provenance rests on every layer above being correct. A link
 * to `169.254.169.254` costs nothing to refuse and everything to serve.
 *
 * `endsWith(".googleusercontent.com")` rather than `includes`, so
 * `googleusercontent.com.evil.example` is not Google's host; https only.
 */
export const googlePictureUrl = (value: string): string | undefined => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== "https:") return undefined
  const host = url.hostname.toLowerCase()
  if (host !== "googleusercontent.com" && !host.endsWith(".googleusercontent.com")) {
    return undefined
  }
  // A URL that carries a query is one whose shape this does not know, so its
  // size is left alone rather than corrupted by an appended suffix.
  if (url.search !== "" || url.hash !== "") return value

  const segment = value.lastIndexOf("/")
  const size = value.indexOf("=", segment)
  return `${size < 0 ? value : value.slice(0, size)}=s${PictureSize}-c`
}

/** The redirect URI, which is the same string in both calls or neither works. */
const redirectUri = (origin: string): string => `${origin}/auth/google/callback`

/**
 * **Both halves of the credential, not just the public one.** An id without a
 * secret would draw a button that cannot complete a single step of the flow — the
 * exchange has nothing to sign in with and the cookies have nothing to seal
 * under — which is the dead control this page refuses to ship, wearing a working
 * control's clothes.
 */
const offeredFrom = (settings: Settings | undefined, origin: string): boolean =>
  settings !== undefined &&
  settings.clientId.length > 0 &&
  settings.clientSecret.length > 0 &&
  settings.origins.includes(origin)

/**
 * The settings resolved for one request, or the refusal that says why not.
 *
 * Both call paths ask the same two questions in the same order, and answering
 * them once is what stops a request from an unregistered origin reaching Google
 * on one path and not the other.
 */
const resolve = (
  settings: Settings | undefined,
  origin: string,
): Effect.Effect<Settings, ImportRefused> => {
  if (settings === undefined || settings.clientId.length === 0) {
    return Effect.fail(new ImportRefused({ reason: "unconfigured" }))
  }
  return settings.origins.includes(origin)
    ? Effect.succeed(settings)
    : Effect.fail(new ImportRefused({ reason: "unknown-origin" }))
}

const json = async (response: Response): Promise<Record<string, unknown>> => {
  const body: unknown = await response.json()
  if (typeof body !== "object" || body === null) throw new Error("not an object")
  return body as Record<string, unknown>
}

/**
 * The operation over whichever settings and transport it was handed — shared by
 * the live layer and the one the suite builds, so the rules are asserted against
 * rather than faked.
 */
/**
 * The secret the cookies are sealed under, or nothing — in which case there is no
 * import on this stage and so nothing to seal or to believe.
 */
const sealingSecret = (settings: Settings | undefined): string | undefined =>
  settings === undefined || settings.clientSecret.length === 0 ? undefined : settings.clientSecret

const identity = (settings: Settings | undefined, fetch: typeof globalThis.fetch): Interface => ({
  offeredAt: (origin) => offeredFrom(settings, origin),

  sealState: Effect.fn("GoogleIdentity.sealState")(function* (request, now) {
    const secret = sealingSecret(settings)
    if (secret === undefined) return yield* new ImportRefused({ reason: "unconfigured" })
    return yield* Effect.promise(() => sealRequest(secret, request, now))
  }),

  readState: Effect.fn("GoogleIdentity.readState")(function* (sealed, now) {
    const secret = sealingSecret(settings)
    if (secret === undefined) return undefined
    return yield* Effect.promise(() => readRequest(secret, sealed, now))
  }),

  sealImport: Effect.fn("GoogleIdentity.sealImport")(function* (profile, now) {
    const secret = sealingSecret(settings)
    if (secret === undefined) return yield* new ImportRefused({ reason: "unconfigured" })
    return yield* Effect.promise(() => sealProfile(secret, profile, now))
  }),

  readImport: Effect.fn("GoogleIdentity.readImport")(function* (sealed, now) {
    const secret = sealingSecret(settings)
    if (secret === undefined) return undefined
    return yield* Effect.promise(() => readProfile(secret, sealed, now))
  }),

  authorizeUrl: Effect.fn("GoogleIdentity.authorizeUrl")(function* (input) {
    const resolved = yield* resolve(settings, input.origin)
    const url = new URL(AuthorizeEndpoint)
    url.searchParams.set("client_id", resolved.clientId)
    url.searchParams.set("redirect_uri", redirectUri(input.origin))
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", Scopes)
    url.searchParams.set("state", input.state)
    // The client may be on a shared machine and is being asked to identify
    // themselves to their coach; whichever account the browser happens to be
    // signed into is not an answer to that question.
    url.searchParams.set("prompt", "select_account")
    return url.toString()
  }),

  profileForCode: Effect.fn("GoogleIdentity.profileForCode")(function* (input) {
    const resolved = yield* resolve(settings, input.origin)

    const exchanged = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(TokenEndpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: input.code,
            client_id: resolved.clientId,
            client_secret: resolved.clientSecret,
            redirect_uri: redirectUri(input.origin),
            grant_type: "authorization_code",
          }).toString(),
        })
        if (!response.ok) throw new Error(`token endpoint answered ${response.status}`)
        return await json(response)
      },
      // No cause and no body: an exchange failure's payload names the code, and
      // a code is a credential for the few seconds it lives (ADR 0004).
      catch: () => new ImportRefused({ reason: "exchange-failed" }),
    })

    const accessToken = text(exchanged.access_token)
    if (accessToken === undefined) {
      return yield* new ImportRefused({ reason: "exchange-failed" })
    }

    const profile = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(ProfileEndpoint, {
          headers: { authorization: `Bearer ${accessToken}` },
        })
        if (!response.ok) throw new Error(`userinfo answered ${response.status}`)
        return await json(response)
      },
      catch: () => new ImportRefused({ reason: "profile-failed" }),
    })

    const sub = text(profile.sub)
    // The one field Google documents as always present. Its absence is Google
    // contradicting itself rather than a profile without an identity, and
    // nothing may be concluded on the strength of it.
    if (sub === undefined) return yield* new ImportRefused({ reason: "profile-failed" })

    const name = text(profile.name)
    const email = text(profile.email)
    const picture = text(profile.picture)
    const pictureUrl = picture === undefined ? undefined : googlePictureUrl(picture)

    return {
      sub,
      emailVerified: profile.email_verified === true,
      ...(name === undefined ? {} : { name }),
      ...(email === undefined ? {} : { email }),
      ...(pictureUrl === undefined ? {} : { pictureUrl }),
    } satisfies GoogleProfile
  }),
})

/**
 * The layer over settings supplied directly — what the suite builds, and what
 * {@link layer} becomes once it has read its configuration.
 */
export const layerFor = (
  settings: Settings | undefined,
  fetch: typeof globalThis.fetch,
): Layer.Layer<Service> => Layer.succeed(Service, Service.of(identity(settings, fetch)))

/**
 * The live layer, and it is **absent rather than broken** on a stage with no
 * OAuth client.
 *
 * Every value defaults to empty, which resolves to `unconfigured`, which the
 * Acceptance Page renders as a column with no Google button — finished, exactly
 * as it has been since #57. A required configuration value here would make an
 * optional convenience the reason a stage will not boot.
 */
export const layer = (fetch: typeof globalThis.fetch) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const clientId = yield* Config.string("GOOGLE_CLIENT_ID").pipe(Config.withDefault(""))
      const clientSecret = yield* Config.redacted("GOOGLE_CLIENT_SECRET").pipe(
        Config.withDefault(Redacted.make("")),
      )
      const origins = yield* Config.string("GOOGLE_REDIRECT_ORIGINS").pipe(Config.withDefault(""))
      return Service.of(
        identity(
          {
            clientId,
            clientSecret: Redacted.value(clientSecret),
            origins: origins
              .split(",")
              .map((origin) => origin.trim())
              .filter((origin) => origin.length > 0),
          },
          fetch,
        ),
      )
    }),
  )

export * as GoogleIdentity from "./google-identity.ts"
