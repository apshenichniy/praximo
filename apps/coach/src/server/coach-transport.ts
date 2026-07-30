/**
 * What every coach server function says on the wire — the words, the shape, and
 * what a failure becomes.
 *
 * One copy, because the rule is one rule and it is a security property rather
 * than a convenience: an `unauthenticated` that could be told apart from a
 * `server` failure is an oracle for enumerating coaches, and a second
 * hand-written `isTagged` is exactly where that distinction drifts. It drifted
 * once already (#234) — the coach-surface transport grew its own mapper that
 * agreed by luck — which is why the mapping is now reachable only through
 * {@link coachFailure} and pinned by a test.
 *
 * Neither word is a missing page, and that is what separates this tree from the
 * admin one: a coach who opened the app from the wrong place is a real person who
 * deserves a screen saying so, while the admin console is not somewhere anybody
 * arrives by accident.
 */
export type CoachTransportError = "unauthenticated" | "server"

/**
 * What a coach operation answers with: the payload it was asked for, or one word
 * for why not.
 *
 * `Extra` is the per-operation vocabulary — `"invalid"`, `"gone"`, `"stale"` —
 * and it is deliberately additive: a refusal a screen can act on is a decision
 * that operation made, while the two words above are the ones every operation
 * shares.
 */
export type CoachResult<Payload, Extra extends string = never> =
  | ({ readonly ok: true } & Payload)
  | CoachRefusal<Extra>

/** A refusal on its own — the half the conveyor answers with, named so it is written once. */
export interface CoachRefusal<Extra extends string = never> {
  readonly ok: false
  readonly error: CoachTransportError | Extra
}

/**
 * Every word a given result is allowed to refuse with.
 *
 * This is what stops an operation widening its own vocabulary by accident: the
 * builder constrains its failure map against it, so a `_tag` mapped onto a word
 * the result type never declared is a type error rather than a new word on the
 * wire.
 */
export type CoachRefusalWord<Result> = [Extract<Result, { readonly ok: false }>] extends [never]
  ? never
  : Extract<Result, { readonly ok: false }> extends { readonly error: infer Word extends string }
    ? Word
    : never

/** The `_tag` of a service failure, mapped onto one word an operation may say. */
export type CoachFailureMap<Word extends string = string> = Readonly<Record<string, Word>>

/**
 * Which typed failure crossed the runtime boundary. The tag is all that survives
 * `runPromise`, so this is the one thing every handler asks.
 *
 * Unexported, along with the rule below it: the drift this module exists to
 * prevent begins with a second caller reaching for these two and writing its own
 * `unauthenticated` branch. {@link coachFailure} is the only way out of here.
 */
const isTagged = (error: unknown, tag: string): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === tag

const transportError = (error: unknown): CoachTransportError =>
  isTagged(error, "CoachSession.Unauthenticated") ? "unauthenticated" : "server"

/**
 * The failure, as the one word this operation is allowed to say.
 *
 * `named` maps a service's own tags onto that operation's extra vocabulary. It
 * is consulted first and the shared rule answers everything else — so an
 * operation can add a word it can act on without ever being able to *subtract*
 * the undifferentiated `unauthenticated`.
 */
export const coachFailure = <Named extends CoachFailureMap>(
  error: unknown,
  named: Named | undefined,
): CoachTransportError | Named[keyof Named] => {
  for (const tag in named) {
    if (isTagged(error, tag)) return named[tag]
  }
  return transportError(error)
}
