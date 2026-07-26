import { describe, expect, it } from "vitest"
import { developmentCoachPublicKey } from "./development-coach-credential.ts"

/**
 * The one property this minter rests on: **the signer and the trust anchor are
 * halves of one pair**, process-wide.
 *
 * It broke silently once. TanStack Start extracts a server function into a
 * module of its own (`…?tss-serverfn-split`), so this file is evaluated twice in
 * one Vite dev process — once for the handler that signs, once for
 * `runtime.server.ts`'s `await import` of the public half. With the pair cached
 * in a module-level `let`, that is two `generateKey` calls and two pairs, and
 * every coach launch is verified against the wrong one. The symptom is an
 * `unauthenticated` on every coach screen with nothing in the logs, while the
 * manager side — HMAC over a token, no generated key — keeps working and hides
 * the shape of the fault.
 *
 * Vitest loads the module once, so no test here can reproduce the duplication.
 * What a test *can* pin is the mechanism that survives it: the cache is on
 * `globalThis` under a well-known symbol, so any number of module instances in a
 * process share one pair. A revert to module-level state fails this.
 */
const KeyPairSlot = Symbol.for("praximo.development.coachKeyPair")

describe("the development coach key pair", () => {
  it("caches process-wide rather than per module instance", async () => {
    const host = globalThis as unknown as Record<symbol, unknown>
    expect(host[KeyPairSlot], "before the first use").toBeUndefined()

    const key = await developmentCoachPublicKey()

    expect(host[KeyPairSlot], "a second module instance has to find this").toBeDefined()
    // A raw Ed25519 public key: 32 bytes, printed as hex.
    expect(key).toMatch(/^[\da-f]{64}$/)
  })

  it("hands back the same public half every time it is asked", async () => {
    expect(await developmentCoachPublicKey()).toBe(await developmentCoachPublicKey())
  })
})
