/**
 * Why a link did not open a door, in the four ways that differ to the person
 * holding it (#57).
 *
 * Pure, and separate from the page and the repository both, because this is the
 * one piece of the acceptance flow that is a *policy* rather than a read or a
 * render: which of four sentences a client is owed, given a row and a clock.
 *
 * The bot's equivalent (`apps/bot/src/client-acceptance.ts`) has a fifth input
 * — the Telegram id that accepted — and uses it to split "you are already set
 * up" from "somebody else used this link". The web cannot: nobody is signed in
 * here, which is the whole reason this surface exists. So the split this one
 * makes is by *cause* instead, and it lands on something arguably more useful:
 * done, replaced, or too late.
 */

export type WebRefusal =
  /**
   * The common case, and not an error at all — the client kept the message and
   * opened it again. The page says so and offers nothing to press. It discloses
   * no session details either: the token is spent, and turning a used
   * invitation into a permanent read-only view of somebody's schedule is not a
   * trade worth making for a link that gets forwarded.
   */
  | "already-accepted"
  /** The coach reissued; a newer link exists and this one was retired for it. */
  | "superseded"
  /** Seven days ran out with nobody walking through. */
  | "expired"

export interface WebRefusalInput {
  readonly status: "pending" | "accepted" | "expired"
  readonly expiresAt: Date
  readonly now: Date
}

/**
 * `undefined` means the door is open — the caller renders the page.
 *
 * The unknown-token refusal is deliberately *not* in this union. It is decided
 * one level up, where a missing row and a throttled request produce the same
 * answer on purpose: a typo and a token-guessing script must not be able to
 * tell each other apart by what the page says.
 */
export const webRefusal = (input: WebRefusalInput): WebRefusal | undefined => {
  // Acceptance is checked first and beats the clock. A link walked through a
  // fortnight ago is *done*, and telling its owner it has expired would send
  // them to their coach for a replacement they do not need.
  if (input.status === "accepted") return "already-accepted"
  if (input.status === "expired") return "superseded"
  return input.expiresAt.getTime() <= input.now.getTime() ? "expired" : undefined
}
