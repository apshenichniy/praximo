import { createFileRoute } from "@tanstack/react-router"

import { legalRedirect } from "@/server/legal-redirect.ts"
import { clientAppUrl } from "@/server/runtime.server.ts"

/**
 * The coach terms used to be rendered here. See `privacy.ts` — the same move,
 * and the same reason for leaving the address answering.
 */
export const termsRedirectGet = async ({ request }: { request: Request }): Promise<Response> =>
  legalRedirect(await clientAppUrl(), "terms", request.url)

export const Route = createFileRoute("/legal/terms")({
  server: {
    handlers: {
      GET: termsRedirectGet,
    },
  },
})
