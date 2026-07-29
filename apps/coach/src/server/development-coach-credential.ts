import { notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import { coachInput, TransportString } from "./coach-operation.ts"

/**
 * Local development mints a *real* Ed25519 launch and runs the real verifier
 * against it (ADR 0006). There is deliberately no endpoint anywhere that returns
 * a principal: an endpoint that hands out a credential and one that hands out an
 * identity are categorically different things, and only the first can be behind
 * a build-time flag without being a bypass.
 *
 * The key pair is generated once per dev server process and never leaves it.
 * Nothing is written to `.env`, so there is no dev signing key to leak, and a
 * restart simply rotates it — credentials are per launch anyway.
 */
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>

type KeyPair = { readonly privateKey: Key; readonly publicKey: Key }

/**
 * The pair is cached on `globalThis`, not in a module-level `let`.
 *
 * "Once per dev server process" is the property this whole file rests on: the
 * *signer* and the *trust anchor* have to be halves of one pair. A module-level
 * cache does not give that. TanStack Start extracts server functions into a
 * module of their own — `development-coach-credential.ts?tss-serverfn-split` —
 * so this file is instantiated twice in one Vite dev process: once for the
 * handler below, and once for `runtime.server.ts`'s `await import` of
 * `developmentCoachPublicKey`. Two instances, two `generateKey` calls, two
 * pairs — and every launch verified against the wrong half of the wrong one,
 * which surfaces as an unexplained `unauthenticated` on every coach screen while
 * the manager side (HMAC over a token, no generated key) keeps working.
 *
 * A process-wide slot is immune to that by construction. It stays a development
 * concern: `import.meta.env.DEV` folds the handler below out of the production
 * build, and the runtime only reaches for this key when it has already decided
 * it is running locally.
 */
const KeyPairSlot = Symbol.for("praximo.development.coachKeyPair")

type KeyPairHost = { [KeyPairSlot]?: Promise<KeyPair> }

const keyPair = (): Promise<KeyPair> => {
  const host = globalThis as unknown as KeyPairHost
  return (host[KeyPairSlot] ??= crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as Promise<KeyPair>)
}

/**
 * The public half, for the runtime to anchor `CoachInitData` on in development.
 * Supplying a public key can only make verification fail — never succeed — so
 * this is a choice of trust anchor, not a hole in one.
 */
export const developmentCoachPublicKey = async (): Promise<string> => {
  const raw = await crypto.subtle.exportKey("raw", (await keyPair()).publicKey)
  return [...new Uint8Array(raw)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

const signLaunch = async (botId: string, telegramId: string, authDate: number): Promise<string> => {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "praximo-local-development",
    user: JSON.stringify({ id: Number(telegramId), first_name: "Local", last_name: "Coach" }),
  })
  const sorted = new URLSearchParams(params)
  sorted.sort()
  const lines = [...sorted.entries()].map(([key, value]) => `${key}=${value}`)
  const signature = await crypto.subtle.sign(
    "Ed25519",
    (await keyPair()).privateKey,
    new TextEncoder().encode([`${botId}:WebAppData`, ...lines].join("\n")),
  )
  params.set(
    "signature",
    btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", ""),
  )
  return params.toString()
}

/**
 * Local Vite only. `import.meta.env.DEV` is a build-time constant, so the
 * production build folds this to `if (true) throw notFound()` and eliminates
 * everything below it — the same mechanism the admin minter beside it relies on.
 */
export const loadDevelopmentCoachInitData = createServerFn({ method: "POST" })
  .validator(coachInput(Schema.Struct({ botId: TransportString })))
  .handler(async ({ data }) => {
    if (!import.meta.env.DEV) throw notFound()

    const telegramId = process.env.DEV_COACH_TELEGRAM_ID?.trim()
    if (
      !/^\d+$/.test(data.botId) ||
      !telegramId ||
      !/^[1-9]\d*$/.test(telegramId) ||
      !Number.isSafeInteger(Number(telegramId))
    ) {
      throw notFound()
    }

    return signLaunch(data.botId, telegramId, Math.floor(Date.now() / 1_000))
  })
