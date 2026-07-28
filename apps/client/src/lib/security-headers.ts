/**
 * The headers every response from this Worker carries.
 *
 * `Referrer-Policy: no-referrer` is required rather than advisable here
 * (client-onboarding-auth.md §Acceptance sequence — web page, §Web-room access):
 * the two URLs a client is ever handed carry a token in the path —
 * `me.praximo.io/i/<token>` and the room's join link — and the default
 * `strict-origin-when-cross-origin` sends the full URL to any same-origin
 * destination and the origin to cross-origin ones. One image, one font, one
 * analytics beacon on a page that names a single-use invitation is all it takes
 * to hand that invitation to somebody else's log.
 *
 * Applied to **every** route rather than to the token-bearing ones, because the
 * page that needs it most is the one nobody remembered to annotate. It costs the
 * legal pages nothing: they link outward to nothing.
 *
 * Stated as a plain record so the policy is testable without a server. The
 * middleware in `start.ts` is the thing that applies it.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Referrer-Policy": "no-referrer",
}

/**
 * Put them on a response, without touching what the framework already set.
 *
 * The response is rebuilt rather than mutated: a `Response` produced by the
 * router may carry immutable headers (one built from `Response.redirect`, for
 * instance), and `headers.set` on those throws — which would turn a header
 * policy into a 500 on exactly the redirect this app is about to start serving.
 */
export const withSecurityHeaders = (response: Response): Response => {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
