import { createFileRoute } from "@tanstack/react-router"

import { startImport } from "@/server/google-flow.ts"
import { inviteLimiters, runAcceptance } from "@/server/runtime.server.ts"
import { connectingIp, throttle } from "@/server/throttle.ts"

/**
 * Where **Continue with Google** actually goes (#59).
 *
 * **A same-origin route rather than Google's address directly, and the popup is
 * the reason.** A popup opens unblocked only when `window.open` runs
 * synchronously inside the click, which rules out asking a server for an
 * authorization URL first. So the click opens *this*, and this is what knows the
 * client id, mints the `state` and answers with the redirect — no OAuth
 * parameters in the page, and no Google script to build them.
 *
 * Nothing here happens until the press, which is the whole of the criterion the
 * page is otherwise built to satisfy: no Google script, no Google request and no
 * cookie of any kind before a client has decided there should be one.
 *
 * The decision is `startImport`'s; this is the wiring a suite cannot reach,
 * because it holds the rate-limit binding and therefore `cloudflare:workers`.
 */
export const googleStartGet = async ({ request }: { request: Request }): Promise<Response> => {
  // Counted against the *lookup* allowance, sharing the bucket with the page for
  // the reason the avatar route shares it: a loop that cannot spend the page's
  // must not be handed a second one by a route beside it.
  const limiters = await inviteLimiters()
  const allowed = await throttle(limiters.lookup, connectingIp(request.headers))
  return runAcceptance(startImport({ url: new URL(request.url), throttled: !allowed }))
}

export const Route = createFileRoute("/auth/google/start")({
  server: { handlers: { GET: googleStartGet } },
})
