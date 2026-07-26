/**
 * What every coach server function does with a failure.
 *
 * One copy, because the rule is one rule and it is a security property rather
 * than a convenience: an `unauthenticated` that could be told apart from a
 * `server` failure is an oracle for enumerating coaches, and a second
 * hand-written `isTagged` is exactly where that distinction drifts.
 */
export type CoachTransportError = "unauthenticated" | "server"

/**
 * Which typed failure crossed the runtime boundary. The tag is all that survives
 * `runPromise`, so this is the one thing every handler asks.
 */
export const isTagged = (error: unknown, tag: string): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === tag

export const transportError = (error: unknown): CoachTransportError =>
  isTagged(error, "CoachSession.Unauthenticated") ? "unauthenticated" : "server"
