import { sharePreparedMessage, type ShareInviteOutcome } from "@/presentation-host"
import { prepareInviteCard, recordInviteDelivery } from "@/server/coach-clients.functions.ts"

/**
 * Hand the client's invitation to Telegram's own chat picker (#179).
 *
 * On Bot API 8.0+ the **coach's own bot** authors the message: a card minted on
 * this tap, carrying the `t.me/<coach_bot>?start=inv_<token>` deep link on a
 * button. The author matters more than the format — the client is being
 * introduced to their coach's assistant, and a card labelled "via @PraximoBot"
 * would introduce them to a platform instead.
 *
 * Below 8.0 the same link goes out as `t.me/share/url`: the coach's own
 * forwarded text, which is the only role #56 left that form. The link is never
 * duplicated there — it travels as the `url`, and the prose beside it as the
 * `text`.
 *
 * Either form that actually reached the picker is written down as a Telegram
 * delivery (#224). Recorded here rather than at the two call sites because both
 * are the same event: the client's own screen and the resend on an unaccepted
 * session (#61) hand the same invitation to the same picker, and a coach who
 * resent one has delivered it just as much as one who sent it the first time.
 */

/**
 * - `"no-telegram"` — no Mini App bridge at all (a plain browser); the link
 *   opened in a new tab instead.
 * - `"gone"` — the invitation is no longer shareable; the screen needs re-reading.
 * - `"failed"` — the card could not be minted. Retryable: the invitation is
 *   untouched and tapping again is safe.
 */
export type ShareClientInviteOutcome = ShareInviteOutcome | "no-telegram" | "gone" | "failed"

/**
 * How close to its expiry a prepared id stops being worth handing to the picker.
 *
 * Telegram's `expiration_date` is read rather than assumed, and the gap between
 * minting and sharing is a round trip plus however long the coach's phone takes
 * to draw the picker. A card inside this margin is re-minted rather than shared,
 * because a stale id fails at Telegram — after the coach has already chosen who
 * to send it to.
 */
export const CARD_FRESHNESS_MARGIN_MILLIS = 10_000

export const shareClientInvite = async (options: {
  readonly clientId: string
  readonly link: string
  /**
   * The whole forwardable message, ending with the link — the same string the
   * copy button copies. `shareInviteMessage` strips that last line back off for
   * the `t.me/share/url` form, where the link is a parameter of its own.
   */
  readonly message: string
}): Promise<ShareClientInviteOutcome> => {
  const message = options.message
  try {
    const outcome = await sharePreparedMessage({
      prepare: async () => {
        // One re-mint and no more: a second card that comes back already stale
        // means the clocks disagree, and asking a third time would only spend
        // another round trip on the same answer.
        const first = await mintCard(options.clientId)
        if (isStillShareable(first)) return first.preparedMessageId
        return (await mintCard(options.clientId)).preparedMessageId
      },
      link: options.link,
      message,
    })
    if (outcome !== "no-host") {
      // `shared` is the picker's own callback; `fallback` is the sub-8.0 form,
      // where the invitation lands in the chat picker's input field. A
      // `dismissed` picker sent nothing, and telling a coach who changed their
      // mind otherwise would put a fiction in the list a week later.
      //
      // Best-effort, and never allowed to fail the share: by this point the
      // invitation has left the coach's phone, and a bookkeeping error
      // surfacing as «не отправлено» would be the screen contradicting
      // something they just watched happen.
      if (outcome === "shared" || outcome === "fallback") {
        await recordInviteDelivery({
          data: { clientId: options.clientId, kind: "telegram" },
        }).catch(() => undefined)
      }
      return outcome
    }
    globalThis.open?.(
      `https://t.me/share/url?url=${encodeURIComponent(
        options.link,
      )}&text=${encodeURIComponent(message)}`,
      "_blank",
    )
    return "no-telegram"
  } catch (cause) {
    return cause instanceof CardUnavailable ? "gone" : "failed"
  }
}

/** The invitation the screen is showing no longer exists, or is no longer open. */
class CardUnavailable extends Error {}

const mintCard = async (
  clientId: string,
): Promise<{
  readonly preparedMessageId: string
  readonly expiresAt: string
}> => {
  const result = await prepareInviteCard({ data: { clientId } })
  if (result.ok) return result.card
  if (result.error === "gone") throw new CardUnavailable(result.error)
  throw new Error(result.error)
}

/** An expiry we cannot read is treated as stale, and re-minted. */
const isStillShareable = (card: { readonly expiresAt: string }): boolean =>
  Date.parse(card.expiresAt) - Date.now() > CARD_FRESHNESS_MARGIN_MILLIS
