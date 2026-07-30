import { AvatarRepo } from "@praximo/db"
import { AvatarReader, type ServedAvatar } from "@praximo/storage"
import { Context, Effect, Layer } from "effect"
import { CoachSession, READ_WINDOW_MILLIS } from "./coach-session.ts"
import type { LaunchCredential } from "@/launch-credential.ts"

/**
 * The bytes behind a client's face, for the discs this app draws on the roster and
 * on a client's own route (#231).
 *
 * A service of its own rather than an operation on `CoachClients`, because it is the
 * one thing this Worker answers that is not JSON: it authorises exactly as every
 * read here does and then hands back a response for a browser to cache. Folding
 * that into the service that owns clients, invitations and scheduling would put an
 * HTTP concern inside the one module a screen's whole payload comes from.
 *
 * **The scope is the authorisation.** `clientAvatarKey` is scoped by workspace, so
 * a coach who presents somebody else's client id gets the same answer as one who
 * presents a client with no photo — a 404 the screen renders as initials. That is a
 * property of the statement rather than of a check remembered here.
 */

export interface Interface {
  /**
   * One client's photo, or the answer that there is none.
   *
   * `ifNoneMatch` is the request's own validator, passed through so a repeat view
   * costs the indexed read this call already makes and nothing else — no R2. The
   * caching rules themselves are `AvatarReader`'s, shared with the Acceptance Page
   * so the two routes cannot disagree about what may cache an avatar.
   */
  readonly clientPhoto: (
    credential: LaunchCredential,
    clientId: string,
    ifNoneMatch: string | null,
  ) => Effect.Effect<ServedAvatar, CoachSession.Unauthenticated | CoachSession.LoadFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/coach/CoachAvatars") {}

const failed = (operation: string) => () => new CoachSession.LoadFailed({ operation })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* CoachSession.Service
    const avatars = yield* AvatarRepo.Service
    const reader = yield* AvatarReader.Service

    /**
     * The read window, not the write one: this is a read, and it is one a browser
     * makes repeatedly from a page the coach has had open — an avatar that expired
     * fifteen minutes into a session would be a broken disc on a working screen.
     */
    const clientPhoto = Effect.fn("CoachAvatars.clientPhoto")(function* (
      credential: LaunchCredential,
      clientId: string,
      ifNoneMatch: string | null,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, READ_WINDOW_MILLIS)
      const key = yield* avatars
        .clientAvatarKey(principal.workspaceId, clientId)
        .pipe(Effect.mapError(failed("AvatarRepo.clientAvatarKey")))
      return yield* reader.serve({ key, ifNoneMatch })
    })

    return Service.of({ clientPhoto })
  }),
)

export * as CoachAvatars from "./coach-avatars.ts"
