import { ClientInviteTokenPattern, type CoachLanguage, narrowCoachLanguage } from "@praximo/domain"
import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { Effect } from "effect"

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
    return runAcceptance(Effect.flatMap(WebAcceptance.Service, (s) => s.open(token, language)))
  })

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
    return runAcceptance(
      Effect.flatMap(WebAcceptance.Service, (s) =>
        s.accept({
          token,
          name: data.name,
          email: data.email,
          language: data.language,
        }),
      ),
    )
  })
