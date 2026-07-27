import { narrowCoachLanguage } from "@praximo/domain"

import { legalUrl, type LegalDocumentName } from "@/lib/legal-url.ts"

/**
 * What `app.praximo.io/legal/*` now does: send the reader to `my.praximo.io`.
 *
 * The texts moved with the client app (#191), and links to the old addresses are
 * already out in the world — inside bot messages a coach forwarded, in a
 * client's chat history. A message sent last month has to keep working, so the
 * routes stay and answer with a redirect instead of a page.
 *
 * **301, not 302.** The move is permanent, and a permanent answer is what lets a
 * browser and a crawler stop asking. The cost of being wrong is a cached
 * redirect, and the URL it caches is one we own.
 *
 * The language is preserved because it is the whole content of these links: a
 * client sent a Russian policy must not land on an English one because a
 * redirect dropped a query parameter. It is re-narrowed rather than passed
 * through — the destination validates it anyway, and forwarding an arbitrary
 * caller-supplied string into a `Location` header is not a thing to do.
 */
export const legalRedirect = (
  origin: string,
  document: LegalDocumentName,
  url: string,
): Response => {
  if (!isUsableOrigin(origin)) {
    // Only reachable if the Worker is deployed without its binding, which the
    // Alchemy stack does not allow. Said out loud rather than redirected to a
    // relative path, which would loop this route into itself.
    return new Response("legal pages are not configured on this deployment", { status: 500 })
  }

  const language = narrowCoachLanguage(new URL(url).searchParams.get("lang") ?? undefined)

  return new Response(null, {
    status: 301,
    headers: { location: legalUrl(origin, document, language), "cache-control": "no-cache" },
  })
}

/** An origin has to be an absolute `http(s)` URL, or the `Location` is nonsense. */
const isUsableOrigin = (origin: string): boolean => {
  try {
    return ["http:", "https:"].includes(new URL(origin).protocol)
  } catch {
    return false
  }
}
