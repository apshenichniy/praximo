import { createFileRoute } from "@tanstack/react-router"

import { legalRedirect } from "@/server/legal-redirect.ts"
import { clientAppUrl } from "@/server/runtime.server.ts"

/**
 * The privacy policy used to be rendered here. It is served from the client app
 * now (#191), and this route exists only so the links already sent — in bot
 * messages, in clients' chat histories — keep opening it.
 */
export const privacyRedirectGet = async ({ request }: { request: Request }): Promise<Response> =>
  legalRedirect(await clientAppUrl(), "privacy", request.url)

export const Route = createFileRoute("/legal/privacy")({
  server: {
    handlers: {
      GET: privacyRedirectGet,
    },
  },
})
