import { describe, expect, it } from "vitest"

import { connectingIp, throttle } from "./throttle.ts"

const limiter = (outcomes: ReadonlyArray<boolean>) => {
  const keys: Array<string> = []
  let call = 0
  return {
    keys,
    binding: {
      limit: (options: { readonly key: string }) => {
        keys.push(options.key)
        const success = outcomes[call] ?? true
        call += 1
        return Promise.resolve({ success })
      },
    },
  }
}

describe("connecting ip", () => {
  it("reads the header Cloudflare puts the real client address in", () => {
    const headers = new Headers({ "CF-Connecting-IP": "203.0.113.7" })
    expect(connectingIp(headers)).toBe("203.0.113.7")
  })

  /**
   * One bucket for every request that arrives without the header, rather than
   * one bucket each. `X-Forwarded-For` is not consulted: it is caller-supplied,
   * so honouring it would hand anyone with a loop an unlimited supply of keys —
   * which is the exact thing this limit exists to deny.
   */
  it("buckets an address-less request together rather than letting it through", () => {
    expect(connectingIp(new Headers())).toBe("unknown")
    expect(connectingIp(new Headers({ "X-Forwarded-For": "198.51.100.4" }))).toBe("unknown")
  })
})

describe("throttle", () => {
  it("counts the caller's address against the binding", async () => {
    const { keys, binding } = limiter([true])
    expect(await throttle(binding, "203.0.113.7")).toBe(true)
    expect(keys).toEqual(["203.0.113.7"])
  })

  it("reports a refusal so the caller can answer with the unknown page", async () => {
    const { binding } = limiter([false])
    expect(await throttle(binding, "203.0.113.7")).toBe(false)
  })

  /**
   * Local development has no binding — `vite dev` is not workerd — and the
   * choice of what to do about that is the whole reason this is a function.
   *
   * It fails **open**. The alternative would make every developer's first run of
   * the acceptance page a 429, to defend a database that is theirs and empty.
   * What the limit actually buys in production is that `/i/*` is not a free
   * query for anyone with a loop; it is not, and is nowhere claimed to be,
   * protection against guessing a token — twelve symbols from a 32-character
   * alphabet is ≈ 1.2 × 10¹⁸, and no per-colo best-effort counter is what stands
   * between a stranger and a client's join links.
   */
  it("allows when the deployment has no limiter at all", async () => {
    expect(await throttle(undefined, "203.0.113.7")).toBe(true)
  })

  /** A limiter that throws must not become a 500 on the page it protects. */
  it("allows when the limiter itself fails", async () => {
    const binding = { limit: () => Promise.reject(new Error("rate limit unavailable")) }
    expect(await throttle(binding, "203.0.113.7")).toBe(true)
  })
})
