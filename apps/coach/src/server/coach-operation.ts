import { Effect, Exit, Option, Schema } from "effect"
import type { CoachAvatars } from "./coach-avatars.ts"
import type { CoachClients } from "./coach-clients.ts"
import type { CoachSessions } from "./coach-sessions.ts"
import type { CoachSurface } from "./coach-surface.ts"
import {
  type CoachFailureMap,
  coachFailure,
  type CoachRefusal,
  type CoachRefusalWord,
} from "./coach-transport.ts"
import type { LaunchCredential } from "@/launch-credential.ts"

/**
 * The coach conveyor: what happens between a `createServerFn` handler and one of
 * this Worker's services, in one place (#234).
 *
 * It owns the three lines that used to be pasted into all 22 handlers — the
 * empty-credential refusal, the `try/catch`, and the error-mapping rule — and
 * the reading of whatever the browser sent. What it deliberately does *not* own:
 *
 * - **The `createServerFn` chain — including `.middleware([launchCredential])`.**
 *   #234 asked for the middleware attachment to live here too, and it cannot: the
 *   Start compiler extracts a handler by finding `createServerFn(...).handler(...)`
 *   assigned to a variable and names the RPC after that variable, so a helper that
 *   called `createServerFn` itself would collapse every operation onto one
 *   endpoint — and `.middleware` is a link in that same chain, not a separable
 *   step. The chain stays at each call site; what {@link coachConveyor} hands back
 *   is the handler to give it.
 * - **The credential.** It is read from headers by the `launchCredential`
 *   middleware and nothing else (ADR 0006, property 1). The handlers built here
 *   *require* a `context.credential`, so an operation that forgot the middleware
 *   does not typecheck. That is what the attachment being one line per operation
 *   costs us and what it does not: a forgotten middleware is a compile error, not
 *   an unauthenticated endpoint.
 * - **The `auth_date` window.** Twenty-four hours for a read, fifteen minutes for
 *   a write, chosen per operation inside the service (ADR 0006). A default here
 *   would be a security decision made by the layer with the least idea which
 *   operation it is running.
 */

/** Everything this Worker's runtime provides, named once. */
export type CoachServices =
  | CoachAvatars.Service
  | CoachClients.Service
  | CoachSessions.Service
  | CoachSurface.Service

/**
 * The one way into the runtime — `runCoach`, in practice. Taken as a parameter
 * rather than imported so the conveyor can be driven without a Worker, which is
 * what makes "a blank credential never reaches the runtime" a testable claim
 * rather than a comment.
 */
export type CoachRunner = <A, E>(effect: Effect.Effect<A, E, CoachServices>) => Promise<A>

/**
 * What the middleware and the validator leave for the handler. Narrower than
 * Start's own context on purpose: an operation gets the credential and its input,
 * and nothing else about the request.
 */
interface CoachHandlerContext<Data> {
  readonly context: { readonly credential: LaunchCredential }
  readonly data: Data
}

/**
 * A field the browser may or may not have sent, read as the value the far side
 * refuses.
 *
 * Every reader here is **total**, and that is the whole point: the fence is the
 * domain schema inside the service, never this. A validator that threw would turn
 * a mangled request into a `server` failure, and one that guessed would turn it
 * into a silent write — so an unreadable field arrives as the value that makes
 * the service say no for the same reason it would have anyway.
 */
const readable = <T>(schema: Schema.Codec<T, T>, absent: T) =>
  schema.pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(absent))),
    Schema.withDecodingDefault(Effect.succeed(absent)),
  )

/** A string, or the empty one — which no identifier, date, name or address is. */
export const TransportString = readable(Schema.String, "")

/**
 * A finite number, or the one the operation treats as "nothing usable".
 *
 * `Finite` rather than `Number`, which unifies a disagreement the hand-written
 * validators had with each other: the range read excluded `NaN` and the schedule
 * write forwarded it. Neither `NaN` nor `Infinity` is a minute or a day count, so
 * the service refused them anyway — this only decides which layer says so.
 */
export const TransportNumber = (absent: number) => readable(Schema.Finite, absent)

/**
 * A value this layer refuses to look at (#210's working hours): the far side
 * parses it strictly, and anything read here would only be a second opinion able
 * to disagree.
 */
export const TransportValue = readable(Schema.Unknown, undefined)

/**
 * The input, read once from the shape it is declared in.
 *
 * The answer to input that is not even an object is not declared separately
 * because it cannot differ: it is what the fields themselves say an empty request
 * means. A shape with a field that has no such answer makes this module fail to
 * load rather than hand a handler an input missing the key it is about to read.
 */
export const coachInput = <Input>(shape: Schema.ConstraintDecoder<Input>) => {
  const read = Schema.decodeUnknownExit(shape)
  const absent = Exit.match(read({}), {
    onFailure: (): Input => {
      throw new Error("coach input: every field must read an absent request")
    },
    onSuccess: (data) => data,
  })
  return (input: unknown): Input =>
    Exit.match(read(input), { onFailure: () => absent, onSuccess: (data) => data })
}

/**
 * A launch that carried no credential at all.
 *
 * Refused before the runtime is touched, and *not* by the verifier: this is not a
 * coach whose credential failed, it is a request from somewhere that never had
 * one, and it must not cost a database round trip. Named here because both exits
 * below owe the same answer to it.
 */
const blank = (credential: LaunchCredential): boolean => credential.initData.length === 0

/**
 * The conveyor, bound to one way into the runtime.
 *
 * @see {@link CoachRunner} for why the runner is a parameter.
 */
export const coachConveyor = (run: CoachRunner) => {
  /**
   * One coach operation: a credential, an effect, and a tagged result.
   *
   * Adding an operation is one `Interface` entry and one of these calls. The
   * `createServerFn` chain and the input shape are still written out beside it —
   * see the note at the top of this file for why they cannot move — so this is
   * fewer *decisions* per operation rather than fewer lines.
   */
  const operation =
    <
      A,
      E,
      Data,
      Result extends { readonly ok: true } | CoachRefusal<string>,
      const Failures extends CoachFailureMap<CoachRefusalWord<Result>> = CoachFailureMap<never>,
    >(spec: {
      readonly run: (credential: LaunchCredential, data: Data) => Effect.Effect<A, E, CoachServices>
      /** What a success is on the wire. Annotate it with the operation's result type. */
      readonly answer: (value: A) => Result
      /**
       * The service tags this operation answers with a word of its own.
       *
       * Constrained to the words `answer`'s own result type declares, so a
       * misspelled one cannot quietly widen what this operation says on the wire.
       */
      readonly failures?: Failures
    }) =>
    async ({
      context,
      data,
    }: CoachHandlerContext<Data>): Promise<Result | CoachRefusal<Failures[keyof Failures]>> => {
      if (blank(context.credential)) return { ok: false, error: "unauthenticated" }
      try {
        return spec.answer(await run(spec.run(context.credential, data)))
      } catch (error) {
        return { ok: false, error: coachFailure<Failures>(error, spec.failures) }
      }
    }

  /**
   * An operation that answers `{ ok }` and nothing else.
   *
   * Kept as its own exit rather than folded into {@link operation} — reviewed and
   * decided in #234, not inherited. **Four** operations answer this way
   * (`recordInviteDelivery`, `saveTimezone`, `hideMainMiniAppHint`,
   * `saveWorkingHours`); #234 says six because it counted `return { ok: false }`
   * statements, and each of the four had two — the credential guard and the
   * `catch`. Both are now here, once.
   *
   * For all four, *which* refusal they hit is not a distinction the screen can
   * act on: the delivery has already happened, or the next launch writes the
   * value again, and the screen re-reads itself either way. Giving them the
   * tagged result would put a word on the wire that no caller reads and that a
   * caller could start reading.
   *
   * It is not "best effort" in the sense of swallowing anything that matters:
   * `ok` still carries whether the write landed.
   */
  const acknowledgement =
    <A, E, Data>(spec: {
      readonly run: (credential: LaunchCredential, data: Data) => Effect.Effect<A, E, CoachServices>
      readonly acknowledged: (value: A) => boolean
    }) =>
    async ({ context, data }: CoachHandlerContext<Data>): Promise<{ readonly ok: boolean }> => {
      if (blank(context.credential)) return { ok: false }
      try {
        return { ok: spec.acknowledged(await run(spec.run(context.credential, data))) }
      } catch {
        return { ok: false }
      }
    }

  return { operation, acknowledgement }
}
