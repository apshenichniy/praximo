import { launchCredentialFromHeaders } from "@praximo/mini-app/launch-credential"
import { avatarRefusal, type ServedAvatar } from "@praximo/storage"
import { createFileRoute } from "@tanstack/react-router"
import { Effect, Result } from "effect"

import { CoachAvatars } from "@/server/coach-avatars.ts"
import { coachFailure } from "@/server/coach-transport.ts"
import { runCoach } from "@/server/runtime.server.ts"

/**
 * One client's photo, keyed by the client and authorised by the launch credential
 * (#231).
 *
 * **Keyed by the entity, never by the object.** No R2 key appears in this address,
 * so the capability-URL question — who else can hold it, and for how long — never
 * has to be answered: the address means "that client's current photo, if you are
 * their coach", and it means nothing at all to anybody else.
 *
 * **Why the Mini App fetches this rather than pointing an `<img src>` at it.** This
 * Worker authorises every read by the `x-praximo-init-data` header the launch
 * carries, and an `<img>` cannot send a header. So the app fetches the bytes with
 * the credential it already attaches to every other call and renders the result;
 * see `use-client-photo.ts`. The alternatives were both larger decisions than this
 * route: a signed URL is the capability question again, and an ambient credential
 * cookie is ADR 0006's to make.
 *
 * A `GET` with a credential in a header still caches — `AvatarReader` sets a strong
 * `ETag` and `private` freshness, and this route answers `304` from the key without
 * opening the bucket.
 *
 * Escaped out of `/clients/$clientId`'s route (`$clientId_`) so it is a sibling
 * rather than a child of the screen: it renders nothing and must not inherit a
 * loader.
 */

/**
 * The description the storage package hands back, as an actual response.
 *
 * The one line each Worker writes for itself: `@praximo/storage` typechecks with no
 * DOM lib and no Workers types on purpose (ADR 0002), so it describes the status and
 * the headers — the parts with rules — and leaves the constructor to the runtime that
 * has one. The coalesce is load-bearing: `Response` throws on a body given with a
 * 304, which is the branch this design exists to reach.
 */
export const avatarResponse = (served: ServedAvatar): Response =>
  new Response((served.body ?? null) as BodyInit | null, {
    status: served.status,
    headers: served.headers,
  })

/**
 * What a failed read answers with.
 *
 * Read through `coachFailure` rather than an `isTagged` of this route's own, so it
 * cannot drift from the one rule the rest of the Worker follows about telling an
 * unknown bot from a stale credential (#234) — the distinction that would otherwise
 * be an oracle for enumerating coaches.
 *
 * The **503** matters as much as the 401: a database that could not answer must not
 * be reported as "this client has no photo", because a `no-store` 404 is what the
 * disc would then cache for the rest of the page's life.
 */
export const refusalStatus = (failure: unknown): number =>
  coachFailure(failure, undefined) === "unauthenticated" ? 401 : 503

export const clientAvatarGet = async ({
  params,
  request,
}: {
  readonly params: { readonly clientId: string }
  readonly request: Request
}): Promise<Response> => {
  const credential = launchCredentialFromHeaders((name) => request.headers.get(name) ?? undefined)
  const served = await runCoach(
    Effect.flatMap(CoachAvatars.Service, (service) =>
      service.clientPhoto(credential, params.clientId, request.headers.get("if-none-match")),
    ).pipe(Effect.result),
  )
  if (Result.isFailure(served)) return avatarResponse(avatarRefusal(refusalStatus(served.failure)))
  // A client id from another workspace lands here as a 404, indistinguishable from a
  // client who simply has no photo — the scope is in the statement, so there is
  // nothing for this route to check and nothing for it to leak.
  return avatarResponse(served.success)
}

export const Route = createFileRoute("/clients/$clientId_/avatar")({
  server: {
    handlers: {
      GET: clientAvatarGet,
    },
  },
})
