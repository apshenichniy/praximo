import { loadTelegramWebApp } from "@/lib/telegram.ts"

/**
 * Hand the client's invitation to Telegram's own chat picker.
 *
 * **This is the `t.me/share/url` form**, which #56 keeps as the sub-8.0
 * fallback — and, for now, as the whole of the card action. The 8.0+ path mints
 * a *bot-authored* prepared inline message, and the bot that has to author it is
 * the **coach's own**, not the manager's: the client must land in the chat the
 * invitation is for. Nothing in the codebase can mint one yet — `BotRegistry`
 * lives in `apps/bot` and has no RPC entry point for it — so that half arrives
 * with the RPC rather than as a broken call here.
 *
 * The link is never duplicated: it travels as the `url`, and the prose beside it
 * as the `text`.
 */
export const shareClientInvite = async (options: {
  readonly link: string
  readonly name: string
  /** The same sentence the invitation card shows, minus the link. */
  readonly lead: string
}): Promise<void> => {
  const message = `${options.name}${options.lead}`
  const webApp = await loadTelegramWebApp()
  const url = `https://t.me/share/url?url=${encodeURIComponent(
    options.link,
  )}&text=${encodeURIComponent(message)}`

  if (webApp === undefined) {
    globalThis.open?.(url, "_blank")
    return
  }
  webApp.openTelegramLink(url)
}
