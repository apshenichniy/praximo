import "@tanstack/react-start/server-only"

import { type CoachLanguage, narrowCoachLanguage } from "@praximo/domain"

/**
 * The two cookies the Google profile import rides on (#59), and the seal that
 * makes them worth trusting.
 *
 * **Why cookies at all, on a page whose whole premise is that nobody is signed
 * in.** Neither of these is a session. They are one import's own working state,
 * alive for minutes, bound to the invitation that started it, and gone the
 * moment it is spent. What they buy is that the two values a browser must never
 * choose — the Google `sub`, which is an *attestation*, and the `picture` URL,
 * which becomes a server-side fetch — never pass through the page at all.
 *
 * A `sub` the page could hand back would attest to nothing: anyone could claim
 * anyone's. A picture URL the page could choose would be a request this Worker
 * makes to an address a stranger picked. So the callback seals both server-side
 * and the commit reads them back server-side, and the only thing the page is
 * ever told is the name and address it is about to *show the client*, which they
 * may edit anyway.
 *
 * **`HttpOnly` stops a script; the seal stops the person.** The two are
 * different threats and only the second one matters here — the client is the
 * only party with a reason to edit their own cookie, and a forged `sub` would be
 * a claim on somebody else's future portal account. So every payload carries a
 * MAC and an expiry, and anything that does not verify is simply not an import.
 *
 * The MAC key is derived from `GOOGLE_CLIENT_SECRET` rather than configured
 * separately: this Worker already holds that secret for the code exchange, a
 * second one would be a second thing to provision and rotate, and a one-way
 * derivation with a fixed label keeps the two uses cryptographically apart —
 * the raw secret is never used as a MAC key.
 */

/** Both cookie names carry the product prefix so nothing on the origin collides. */
export const StateCookie = "praximo_g_state"
export const ImportCookie = "praximo_g_import"

/**
 * How long the client has on Google's screen.
 *
 * Ten minutes is generous for "pick an account and press continue" and short
 * enough that an abandoned tab does not leave a usable state around. Its expiry
 * is a refusal the client can act on: the form is still there, untouched.
 */
export const StateLifetimeMillis = 10 * 60_000

/**
 * How long an import stays spendable.
 *
 * Longer than the state's, and deliberately: the client presses the button
 * *first* — that is why it sits above the fields — and then reads five consent
 * points before the commit is reachable at all. An hour covers somebody who was
 * interrupted; beyond that the invitation itself is the thing that has to still
 * be open, and it is checked separately.
 */
export const ImportLifetimeMillis = 60 * 60_000

/** Which way back the callback takes: the popup handshake, or a full-page return. */
export type ImportMode = "popup" | "redirect"

/** What `/auth/google/start` remembers so the callback knows what it is finishing. */
export interface ImportRequest {
  /** The invitation this import belongs to, and the only one it may be spent on. */
  readonly token: string
  /** The language the page was in, so the return lands on the same document. */
  readonly language: CoachLanguage
  readonly mode: ImportMode
  /** Mirrored in Google's `state` parameter — the double submit that binds the two. */
  readonly nonce: string
}

/**
 * What the callback learned, held until the client commits — or never, if they
 * close the page, which is the point of it being a cookie and not a row.
 */
export interface ImportedProfile {
  readonly token: string
  /** The identity attestation. No account is created and no token is kept. */
  readonly sub: string
  readonly name?: string
  readonly email?: string
  /**
   * Read rather than assumed (#28): it is `false` when a non-Google domain is
   * attached to the account. Nothing is gated on it — the address is prefilled
   * either way and stays editable — but the line that says where the data came
   * from will not call an unconfirmed address confirmed.
   */
  readonly emailVerified: boolean
  readonly pictureUrl?: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const base64url = (bytes: Uint8Array): string => {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

const fromBase64url = (value: string): Uint8Array | undefined => {
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"))
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return undefined
  }
}

/**
 * The MAC key, one way out of the client secret.
 *
 * The label is what keeps this key and the secret's real use apart: a digest of
 * `<label>\0<secret>` cannot be turned back into the secret, and a second
 * purpose would take a second label rather than this key.
 */
const macKey = async (secret: string): Promise<CryptoKey> => {
  const material = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`praximo/google-import/v1\0${secret}`),
  )
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ])
}

/** `<payload>.<mac>`, both base64url, the payload carrying its own expiry. */
const seal = async (secret: string, body: unknown, expiresAt: number): Promise<string> => {
  const payload = base64url(encoder.encode(JSON.stringify({ ...(body as object), exp: expiresAt })))
  const key = await macKey(secret)
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  return `${payload}.${base64url(new Uint8Array(mac))}`
}

/**
 * The payload, or nothing at all.
 *
 * There is one answer for every way this can go wrong — no cookie, a truncated
 * one, a forged MAC, an expired seal, a body that is not JSON — because a caller
 * can act on none of the differences. Every one of them means "there is no
 * import here", and the form the client is looking at is the way through either
 * way.
 */
const unseal = async (
  secret: string,
  sealed: string | undefined,
  now: number,
): Promise<Record<string, unknown> | undefined> => {
  if (sealed === undefined || sealed.length === 0) return undefined
  const dot = sealed.indexOf(".")
  if (dot <= 0) return undefined
  const payload = sealed.slice(0, dot)
  const signature = fromBase64url(sealed.slice(dot + 1))
  if (signature === undefined) return undefined

  const key = await macKey(secret)
  // `crypto.subtle.verify` rather than comparing strings: the comparison inside
  // it is the constant-time one, and a hand-rolled `===` on a MAC is the classic
  // way to leak it a byte at a time.
  const valid = await crypto.subtle
    .verify("HMAC", key, signature as BufferSource, encoder.encode(payload))
    .catch(() => false)
  if (!valid) return undefined

  const decoded = fromBase64url(payload)
  if (decoded === undefined) return undefined
  try {
    const body: unknown = JSON.parse(decoder.decode(decoded))
    if (typeof body !== "object" || body === null) return undefined
    const record = body as Record<string, unknown>
    return typeof record.exp === "number" && record.exp >= now ? record : undefined
  } catch {
    return undefined
  }
}

/**
 * A string that is actually there, off a payload nothing has vouched for yet —
 * a decoded cookie here, a `userinfo` body in `google-identity.ts`.
 *
 * Exported because both readers of untrusted JSON in this flow need exactly it,
 * and two copies is how one of them ends up treating `""` as a name.
 */
export const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

export const sealRequest = (secret: string, request: ImportRequest, now: number): Promise<string> =>
  seal(secret, request, now + StateLifetimeMillis)

export const readRequest = async (
  secret: string,
  sealed: string | undefined,
  now: number,
): Promise<ImportRequest | undefined> => {
  const body = await unseal(secret, sealed, now)
  if (body === undefined) return undefined
  const token = text(body.token)
  const nonce = text(body.nonce)
  const mode = body.mode
  if (token === undefined || nonce === undefined) return undefined
  if (mode !== "popup" && mode !== "redirect") return undefined
  return { token, nonce, mode, language: narrowCoachLanguage(text(body.language)) }
}

export const sealProfile = (
  secret: string,
  profile: ImportedProfile,
  now: number,
): Promise<string> => seal(secret, profile, now + ImportLifetimeMillis)

export const readProfile = async (
  secret: string,
  sealed: string | undefined,
  now: number,
): Promise<ImportedProfile | undefined> => {
  const body = await unseal(secret, sealed, now)
  if (body === undefined) return undefined
  const token = text(body.token)
  const sub = text(body.sub)
  if (token === undefined || sub === undefined) return undefined
  // A state cookie seals cleanly under the same key and is not an import; the
  // shapes are told apart by what they carry, not by a tag they could both claim.
  if (text(body.nonce) !== undefined) return undefined
  const name = text(body.name)
  const email = text(body.email)
  const pictureUrl = text(body.pictureUrl)
  return {
    token,
    sub,
    emailVerified: body.emailVerified === true,
    ...(name === undefined ? {} : { name }),
    ...(email === undefined ? {} : { email }),
    ...(pictureUrl === undefined ? {} : { pictureUrl }),
  }
}

/**
 * The value mirrored into Google's `state` parameter — 96 bits from the platform
 * generator, which is all a double-submit check needs: it is compared against a
 * cookie only this origin could have set, never guessed at.
 */
export const newNonce = (): string => base64url(crypto.getRandomValues(new Uint8Array(12)))

export interface CookieOptions {
  /**
   * Set only over https. Safari refuses a `Secure` cookie on a plain-http
   * origin, and local development is plain http on `localhost` — so a flag
   * hard-coded on would make the import undevelopable on one browser and
   * mysteriously so.
   */
  readonly secure: boolean
  readonly maxAgeMillis: number
}

const attributes = (secure: boolean, maxAgeSeconds: number): string =>
  [
    "Path=/",
    "HttpOnly",
    // `Lax` and never `Strict`. Google returns the client by a cross-site
    // top-level navigation, and `Strict` withholds the cookie on exactly that
    // request — the one the whole flow turns on.
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ")

/**
 * Serialized by hand rather than through the framework's cookie helper, for two
 * reasons that point the same way: these routes build their own `Response`
 * rather than mutating an ambient one, and a header this module composes is a
 * header this module's own suite can assert every flag of.
 */
export const cookieHeader = (name: string, value: string, options: CookieOptions): string =>
  `${name}=${value}; ${attributes(options.secure, Math.floor(options.maxAgeMillis / 1000))}`

export const clearCookieHeader = (name: string, options: { readonly secure: boolean }): string =>
  `${name}=; ${attributes(options.secure, 0)}`

/**
 * One cookie off a request's own header.
 *
 * Split on `;` and matched on the whole name, so `not_praximo_g_import` does not
 * answer for `praximo_g_import` — the failure a `header.includes(name)` would
 * have.
 */
export const readCookie = (header: string | null | undefined, name: string): string | undefined => {
  if (header === null || header === undefined || header.length === 0) return undefined
  for (const part of header.split(";")) {
    const equals = part.indexOf("=")
    if (equals < 0) continue
    if (part.slice(0, equals).trim() !== name) continue
    const value = part.slice(equals + 1).trim()
    return value.length === 0 ? undefined : value
  }
  return undefined
}
