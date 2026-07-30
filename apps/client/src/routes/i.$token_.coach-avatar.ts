import { ClientInviteTokenPattern } from "@praximo/domain"
import { avatarRefusal, type ServedAvatar } from "@praximo/storage"
import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import { inviteLimiters, runAcceptance } from "@/server/runtime.server.ts"
import { connectingIp, throttle } from "@/server/throttle.ts"
import { WebAcceptance } from "@/server/web-acceptance.ts"

/**
 * The coach's photo, for the disc the Acceptance Page draws beside their name
 * (#231).
 *
 * **Keyed by the invitation, not by the object.** The page is already at
 * `/i/<token>`, so this address carries nothing the client is not holding, no R2
 * key appears in it, and the question a capability URL would raise — who else can
 * hold this address, and for how long — never comes up: it is the invitation's own
 * address and it dies with it.
 *
 * A plain `<img src>` works here, where it cannot in the coach Mini App, because
 * this surface authorises by something already in the URL rather than by a header
 * only `fetch` can send. `Referrer-Policy: no-referrer` is set on every response
 * from this Worker, so the token in this path does not travel outward either.
 *
 * Escaped out of `/i/$token`'s route (`$token_`) so it is a sibling rather than a
 * child: it must not run that page's loader, which would spend an invitation
 * lookup to serve an image.
 */
/**
 * The description the storage package hands back, as an actual response.
 *
 * The coalesce is load-bearing: `Response` throws on a body given with a 304, and
 * the 304 is the branch this whole design exists to reach.
 */
export const avatarResponse = (served: ServedAvatar): Response =>
  new Response((served.body ?? null) as BodyInit | null, {
    status: served.status,
    headers: served.headers,
  })

export const coachAvatarGet = async ({
  params,
  request,
}: {
  readonly params: { readonly token: string }
  readonly request: Request
}): Promise<Response> => {
  // Shape-checked before it can become a query, exactly as the server functions
  // check it: a path segment from a random crawler never reaches the database.
  if (!ClientInviteTokenPattern.test(params.token)) return avatarResponse(avatarRefusal(404))
  // Counted against the *lookup* allowance, because that is what this is — one
  // more indexed read behind one more token. Sharing the bucket with `openInvite`
  // is deliberate: a loop that cannot spend the page's allowance must not be
  // handed a second one by an image route beside it.
  const limiters = await inviteLimiters()
  if (!(await throttle(limiters.lookup, connectingIp(request.headers))))
    return avatarResponse(avatarRefusal(429))

  const served = await runAcceptance(
    Effect.flatMap(WebAcceptance.Service, (service) =>
      service.coachPhoto(params.token, request.headers.get("if-none-match")),
    ),
  )
  return avatarResponse(served)
}

export const Route = createFileRoute("/i/$token_/coach-avatar")({
  server: {
    handlers: {
      GET: coachAvatarGet,
    },
  },
})
