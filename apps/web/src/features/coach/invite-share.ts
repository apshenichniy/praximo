import { loadTelegramWebApp, shareInviteMessage, type ShareInviteOutcome } from "@/lib/telegram.ts"
import { prepareInviteCard } from "@/server/coach-clients.functions.ts"

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
  readonly name: string
  /** The same sentence the invitation card shows, minus the link. */
  readonly lead: string
}): Promise<ShareClientInviteOutcome> => {
  const message = `${options.name}${options.lead}`
  const webApp = await loadTelegramWebApp()
  if (webApp === undefined) {
    globalThis.open?.(
      `https://t.me/share/url?url=${encodeURIComponent(
        options.link,
      )}&text=${encodeURIComponent(message)}`,
      "_blank",
    )
    return "no-telegram"
  }

  try {
    return await shareInviteMessage(webApp, {
      prepare: async () => {
        // One re-mint and no more: a second card that comes back already stale
        // means the clocks disagree, and asking a third time would only spend
        // another round trip on the same answer.
        const first = await mint(options.clientId)
        if (fresh(first)) return first.preparedMessageId
        return (await mint(options.clientId)).preparedMessageId
      },
      link: options.link,
      message,
    })
  } catch (cause) {
    return cause instanceof CardUnavailable ? "gone" : "failed"
  }
}

/** The invitation the screen is showing no longer exists, or is no longer open. */
class CardUnavailable extends Error {}

const mint = async (clientId: string): Promise<{
  readonly preparedMessageId: string
  readonly expiresAt: string
}> => {
  const result = await prepareInviteCard({ data: { clientId } })
  if (result.ok) return result.card
  if (result.error === "gone") throw new CardUnavailable(result.error)
  throw new Error(result.error)
}

const fresh = (card: { readonly expiresAt: string }): boolean =>
  Date.parse(card.expiresAt) - Date.now() > CARD_FRESHNESS_MARGIN_MILLIS
