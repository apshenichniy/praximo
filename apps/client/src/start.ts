import { createMiddleware, createStart } from "@tanstack/react-start"

import { withSecurityHeaders } from "@/lib/security-headers.ts"

/**
 * A request middleware, which is to say: the only place in a TanStack Start app
 * where *every* response passes through one function. Route-level handlers see
 * their own responses; this sees the document renders, the server-function
 * calls, the redirects and the 404s alike.
 *
 * That is the property `Referrer-Policy: no-referrer` needs. A header set
 * per-route is a header somebody forgets on the route added next month, and the
 * URLs this app serves carry single-use tokens in their paths.
 */
const securityHeaders = createMiddleware({ type: "request" }).server(async ({ next }) => {
  const result = await next()
  return { ...result, response: withSecurityHeaders(result.response) }
})

/**
 * The Start entry, resolved by the plugin at `src/start.ts`.
 *
 * Nothing else lives here yet on purpose: no serialization adapters, no function
 * middleware, because this app has no server functions. `#57` brings the first.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders],
}))
