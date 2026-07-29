/**
 * The rate limits on `/i/*` (#57), and an honest account of what they are for.
 *
 * They keep the route from being a free database query for anyone with a loop.
 * They are **not** protection against guessing a token, and no acceptance
 * criterion claims they are: twelve symbols from a 32-character alphabet is
 * 32¹² ≈ 1.2 × 10¹⁸, which is not a number a per-colo, best-effort counter is
 * needed to defend. An AC that promised protection the mechanism cannot deliver
 * would be worse than none.
 *
 * Two bindings rather than one because a Cloudflare rate limit carries exactly
 * one namespace and one configuration, and the read and the write deserve
 * different numbers — see `alchemy.run.ts`.
 */

/** The shape both the real binding and a test double satisfy. */
export interface Limiter {
  readonly limit: (options: { readonly key: string }) => Promise<{ readonly success: boolean }>
}

/** Structural, so the framework's typed headers and a plain `Headers` both fit. */
export interface HeaderReader {
  readonly get: (name: string) => string | null | undefined
}

/**
 * Who to count against.
 *
 * `CF-Connecting-IP` only. `X-Forwarded-For` is caller-supplied and would hand
 * anyone an unlimited supply of buckets, which is precisely the abuse being
 * counted. A request without the header shares one bucket with every other such
 * request rather than escaping the limit — being unidentifiable is not a reason
 * to be trusted more.
 */
export const connectingIp = (headers: HeaderReader): string =>
  headers.get("CF-Connecting-IP") ?? "unknown"

/**
 * `true` to proceed.
 *
 * Fails **open** in both directions it can fail: no binding (local development,
 * where `vite dev` is not workerd and there is no rate limit to bind) and a
 * binding that throws. The limit protects a query; it is not a gate whose
 * absence should stop a client accepting an invitation, and a limiter outage
 * must not become a 500 on the one page a client is ever sent.
 */
export const throttle = async (limiter: Limiter | undefined, key: string): Promise<boolean> => {
  if (limiter === undefined) return true
  try {
    const { success } = await limiter.limit({ key })
    return success
  } catch {
    return true
  }
}
