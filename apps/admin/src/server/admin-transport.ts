import { notFound } from "@tanstack/react-router"

/**
 * What every admin server function does with a failure.
 *
 * The coach tree has the same module for the same reason (`coach-transport.ts`):
 * a hand-written `"_tag" in error` is where an error vocabulary drifts, and this
 * side had six copies of it. #234 swept only the runtime half into this app and
 * left these alone, because the admin refusals are genuinely per-operation — so
 * what is shared here is the *reading* of a tag and the one rule the whole tree
 * obeys, never the words themselves.
 *
 * The difference from the coach side is worth stating, because it is why these
 * are two modules and not one. There, `unauthenticated` must stay
 * indistinguishable from `server` — telling them apart would be an oracle for
 * enumerating coaches (ADR 0006). Here, refusal *is* a missing page: the admin
 * console is not somewhere anybody arrives by accident, so there is nothing for a
 * response to give away.
 */

/**
 * Which typed failure crossed the runtime boundary. The tag is all that survives
 * `runPromise`, so this is the one thing every handler asks — and the only place
 * that asks it.
 */
const tagOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : undefined

/**
 * The one refusal the whole admin tree answers with a missing page.
 *
 * It **throws rather than returning a word**, and that is the point: `AccessDenied`
 * is not a per-operation outcome that an operation may name for itself, and a
 * mapper that handed it back as a string would let one do exactly that. Every
 * handler below runs this first, so no operation can opt out by forgetting a
 * branch — the way six hand-written cascades each could.
 *
 * A `notFound()` *already* in flight is not what this is for and passes straight
 * through: it carries `isNotFound`, not a `_tag`. That matters because
 * `requireCredential` throws one from inside each handler's `try`, so a blank
 * credential reaches a cascading handler's caller as `server` rather than as the
 * missing page its own doc comment promises. Unchanged here, and stated because
 * this is now the one place it is visible: the entry gate answers first in
 * practice, so nothing reaches these handlers without a credential today.
 */
export const notFoundWhenDenied = (error: unknown): void => {
  if (tagOf(error) === "AdminSurface.AccessDenied") throw notFound()
}

/**
 * Which of the words *this* operation named, or `server`.
 *
 * The vocabularies stay per-operation on purpose — `conflict` means a taken label
 * to a rename and a second deletion to a delete — so this maps rather than
 * decides. Anything the operation did not name is `server`, which is also the
 * honest answer for a failure nobody has thought about yet.
 */
export const transportWord = <Word extends string>(
  error: unknown,
  named: Readonly<Record<string, Word>>,
): Word | "server" => {
  const tag = tagOf(error)
  return (tag === undefined ? undefined : named[tag]) ?? "server"
}

/**
 * The two together: the tree's missing-page rule, then this operation's own word.
 *
 * What five of the six refusing handlers want. The two that do not want it
 * (`recordAdminCoachInviteShare`, which answers `{ ok }` and nothing else, and
 * the entry gate next door, which deliberately never 404s) reach for the halves
 * directly, so the exception is visible at the call site rather than hidden in a
 * flag here.
 */
export const adminRefusal = <Word extends string>(
  error: unknown,
  named: Readonly<Record<string, Word>>,
): Word | "server" => {
  notFoundWhenDenied(error)
  return transportWord(error, named)
}
