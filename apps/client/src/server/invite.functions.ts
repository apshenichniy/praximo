import { ClientInviteTokenPattern, type CoachLanguage, narrowCoachLanguage } from "@praximo/domain"
import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders, getRequestUrl, setResponseHeader } from "@tanstack/react-start/server"
import { Effect } from "effect"

import { GoogleIdentity } from "./google-identity.ts"
import {
  clearCookieHeader,
  ImportCookie,
  type ImportedProfile,
  readCookie,
} from "./google-import.ts"
import { isSecure } from "./google-return.ts"
import { inviteLimiters, runAcceptance } from "./runtime.server.ts"
import { connectingIp, throttle } from "./throttle.ts"
import { WebAcceptance } from "./web-acceptance.ts"

/**
 * This app's first server functions (#57). Until now it had none — `start.ts`
 * says so — because nothing it served was a query.
 *
 * Both of them count the caller against a rate limit before doing any work, and
 * both answer a refusal with the page that names nobody. What the limit buys is
 * that `/i/*` is not a free database query for anyone with a loop; it is not
 * protection against guessing a token, and nothing here claims it is.
 */

/**
 * `true` when this caller has spent their allowance.
 *
 * The polarity is inverted from `throttle`, which answers "may I proceed" — so
 * the name says which question is being asked rather than leaving the reader to
 * infer it from a `!`.
 */
const overLimit = async (which: "lookup" | "commit"): Promise<boolean> => {
  const limiters = await inviteLimiters()
  return !(await throttle(limiters[which], connectingIp(getRequestHeaders())))
}

/**
 * Shape-checked before it can become a query.
 *
 * Twelve symbols from a fixed alphabet: anything else is not a token this
 * product ever issued, and rejecting it here means a path segment from a random
 * crawler never reaches the database at all.
 */
const readToken = (value: unknown): string | undefined =>
  typeof value === "string" && ClientInviteTokenPattern.test(value) ? value : undefined

/**
 * What an unknown token answers in.
 *
 * There is no invitation to read a language from — that is what makes it
 * unknown — so the browser's own preference is the only thing left, and a
 * refusal in a language the reader does not have is worse than useless.
 *
 * Only the first tag is consulted. `Accept-Language` is an ordered list with
 * quality weights, and honouring the whole of it would mean answering in a
 * language the reader ranked *below* one this product does not speak — a worse
 * guess than the default, at more cost.
 */
const preferredLanguage = (header: string | null | undefined): CoachLanguage =>
  narrowCoachLanguage((header ?? "").split(",")[0]?.trim().split(";")[0])

/**
 * The origin this request was served from — where the Google button's redirect
 * URI would point, and therefore whether there is a button at all (#59).
 *
 * Read off the request rather than configured, so one value covers `vite dev`,
 * the canonical stage and anything after it. A spoofed `Host` buys nothing: the
 * origin has to be one Google was told about *and* the redirect URI it produces
 * has to match there exactly, so a lie only fails the liar's own flow.
 */
const requestOrigin = (): string => getRequestUrl().origin

/** The imported profile behind this request's cookie, if it carries a live one. */
const importedProfile = async (): Promise<ImportedProfile | undefined> => {
  const sealed = readCookie(getRequestHeaders().get("cookie"), ImportCookie)
  if (sealed === undefined) return undefined
  return runAcceptance(
    Effect.flatMap(GoogleIdentity.Service, (google) => google.readImport(sealed, Date.now())),
  )
}

export const openInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: readToken((input as { token?: unknown })?.token) }))
  .handler(async ({ data }): Promise<WebAcceptance.AcceptanceOutcome> => {
    const language = preferredLanguage(getRequestHeaders().get("accept-language"))
    const token = data.token
    if (token === undefined) return { kind: "unknown", language }
    // A throttled request and a token nobody issued get the same answer, on
    // purpose: a person with a typo and a script working through the keyspace
    // must not be able to tell each other apart by what the page says.
    if (await overLimit("lookup")) return { kind: "unknown", language }
    const origin = requestOrigin()
    return runAcceptance(
      Effect.flatMap(WebAcceptance.Service, (s) => s.open(token, language, origin)),
    )
  })

/**
 * What the import filled in, for the page to show (#59).
 *
 * **The only reader of that cookie the browser ever talks to, and it hands back
 * two fields.** The `sub` and the picture URL stay sealed and are read again,
 * server-side, by the commit — a `sub` the page could see is a `sub` a page could
 * send, and an attestation somebody can choose attests to nothing.
 *
 * Both signals that an import happened — the popup's `postMessage` and the
 * redirect's `?g` — end here rather than carrying the profile themselves. So no
 * personal data rides a `postMessage`, and a mis-addressed one leaks nothing at
 * all; and there is one place, not two, that decides what an import filled in.
 */
export const googleImport = createServerFn({ method: "POST" }).handler(
  async (): Promise<{
    readonly name?: string
    readonly email?: string
    readonly emailVerified: boolean
  } | null> => {
    // Counted against the lookup allowance for the reason the avatar route is: a
    // loop that cannot spend the page's must not be handed a second one beside it.
    if (await overLimit("lookup")) return null
    const profile = await importedProfile()
    if (profile === undefined) return null
    return {
      ...(profile.name === undefined ? {} : { name: profile.name }),
      ...(profile.email === undefined ? {} : { email: profile.email }),
      emailVerified: profile.emailVerified,
    }
  },
)

interface AcceptPayload {
  readonly token: string | undefined
  readonly name: string
  readonly email: string
  readonly language: CoachLanguage
}

const readString = (value: unknown): string => (typeof value === "string" ? value : "")

export const acceptInvite = createServerFn({ method: "POST" })
  .validator((input: unknown): AcceptPayload => {
    const raw = (input ?? {}) as Record<string, unknown>
    return {
      token: readToken(raw.token),
      name: readString(raw.name),
      email: readString(raw.email),
      // Narrowed for real in the service, which is where the recorded consent
      // version is derived from it.
      language: raw.language as CoachLanguage,
    }
  })
  .handler(async ({ data }): Promise<WebAcceptance.AcceptOutcome> => {
    const token = data.token
    if (token === undefined) return { kind: "stale" }
    if (await overLimit("commit")) return { kind: "stale" }

    /**
     * The attestation, read from the cookie and never from the payload (#59).
     *
     * Bound to *this* invitation: a seal minted while importing for one token
     * cannot be spent on another, so a second tab open on somebody else's link
     * cannot borrow the identity. The page sends nothing about Google at all —
     * it has nothing to send.
     */
    const profile = await importedProfile()
    const attestation =
      profile === undefined || profile.token !== token
        ? undefined
        : {
            sub: profile.sub,
            ...(profile.pictureUrl === undefined ? {} : { pictureUrl: profile.pictureUrl }),
          }

    const outcome = await runAcceptance(
      Effect.flatMap(WebAcceptance.Service, (s) =>
        s.accept({
          token,
          name: data.name,
          email: data.email,
          language: data.language,
          ...(attestation === undefined ? {} : { googleImport: attestation }),
        }),
      ),
    )

    // Spent, so it goes — but only on the commit that spent it. A `stale` or an
    // invalid field is a screen the client is still standing on with the same
    // import behind it, and clearing there would make a corrected typo cost them
    // the Google identity they had already given.
    if (outcome.kind === "accepted") {
      // `isSecure` rather than a second reading of the same question: a cookie
      // cleared under different flags than it was set under is a cookie that
      // does not get cleared.
      setResponseHeader(
        "Set-Cookie",
        clearCookieHeader(ImportCookie, { secure: isSecure(getRequestUrl()) }),
      )
    }
    return outcome
  })
