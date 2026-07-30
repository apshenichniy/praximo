import { createFileRoute } from "@tanstack/react-router"

import { finishImport } from "@/server/google-flow.ts"
import { runAcceptance } from "@/server/runtime.server.ts"

/**
 * Where Google sends the client back (#59) — the one address registered with
 * them, and the only place a code is ever exchanged.
 *
 * **The token is not in this path and cannot be.** Redirect URIs are matched
 * exactly, so there is one URL per origin and nothing per invitation; which
 * invitation this belongs to rides in the sealed state cookie instead, together
 * with the language the page was in and the way back the client came.
 *
 * Deliberately **not** rate-limited, where its sibling is. A callback that gets
 * this far is holding a state cookie this Worker sealed minutes ago; throttling
 * it would spend a client's own allowance on the return leg of a flow they were
 * already invited into, and drop them back on the form for no reason they could
 * see. The exchange it performs is bounded by that cookie, not by a counter.
 *
 * The decision is `finishImport`'s; this is the wiring around it.
 */
export const googleCallbackGet = async ({ request }: { request: Request }): Promise<Response> =>
  runAcceptance(finishImport({ url: new URL(request.url), cookie: request.headers.get("cookie") }))

export const Route = createFileRoute("/auth/google/callback")({
  server: { handlers: { GET: googleCallbackGet } },
})
