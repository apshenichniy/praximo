/**
 * What the host's back button does, decided apart from React so it can be
 * argued with in a test (#186).
 *
 * Both ways of getting this wrong have already shipped. Trusting the history
 * left a Mini App opened from a bot message with a back button that did nothing
 * at all — a deep link lands on its screen with nothing behind it. Then pushing
 * the fallback screen instead made a *loop*: the client's card sent the coach up
 * to the clients list, the list now had the card behind it, and back went down
 * again, for as long as anyone kept pressing.
 *
 * So the fallback **replaces**. Back always means "up" — a screen that was
 * arrived at from outside is left behind rather than kept underneath, and a few
 * presses walk up to Today and stop there.
 */
export type BackAction =
  | { readonly kind: "history" }
  | { readonly kind: "replace"; readonly to: string }

export const backAction = (options: {
  readonly canGoBack: boolean
  readonly fallbackTo: string
}): BackAction =>
  options.canGoBack ? { kind: "history" } : { kind: "replace", to: options.fallbackTo }
