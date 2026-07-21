// The narrow slice of the Telegram Mini App `WebApp` global the app actually
// calls (full API: https://core.telegram.org/bots/webapps). Kept minimal on
// purpose — every method here is exercised by the fullscreen flow below; widen
// it only when a screen needs more.

export interface TelegramWebApp {
  /** The Bot API version the host client implements, e.g. "8.0". */
  readonly version: string
  /** Whether the Mini App is currently expanded to fullscreen (Bot API 8.0). */
  readonly isFullscreen: boolean
  /** Signals the host the Mini App is ready to be shown. */
  ready: () => void
  /** Expands the Mini App to the maximum available height (all versions). */
  expand: () => void
  /** True when the host client implements at least the given Bot API version. */
  isVersionAtLeast: (version: string) => boolean
  /** Requests true fullscreen — Bot API 8.0; a no-op on older clients. */
  requestFullscreen: () => void
  onEvent: (eventType: string, handler: () => void) => void
  offEvent: (eventType: string, handler: () => void) => void
}

declare global {
  interface Window {
    readonly Telegram?: { readonly WebApp?: TelegramWebApp }
  }
}

/** The host script that installs `window.Telegram.WebApp`. */
export const TELEGRAM_WEBAPP_SRC = "https://telegram.org/js/telegram-web-app.js"

/**
 * `requestFullscreen` and the `fullscreenChanged` event are Bot API 8.0
 * (mini-app.md, decided in #14). Below 8.0 the Mini App still `expand()`s but
 * cannot go fullscreen, so the request is skipped rather than firing an error
 * event into a client that can't honour it.
 */
export const FULLSCREEN_MIN_VERSION = "8.0"

/**
 * Take the Mini App fullscreen: mark ready, expand, and — on Bot API 8.0+ —
 * subscribe to `fullscreenChanged` and request fullscreen (mini-app.md). Returns
 * an unsubscribe for the listener, or `undefined` when the host is pre-8.0 and
 * only `expand()` applied. Pure aside from the injected `webApp`, so the version
 * gate is unit-testable without a browser or Telegram host.
 */
export const enterFullscreen = (
  webApp: TelegramWebApp,
  onFullscreenChanged: () => void,
): (() => void) | undefined => {
  webApp.ready()
  webApp.expand()

  if (!webApp.isVersionAtLeast(FULLSCREEN_MIN_VERSION)) return undefined

  webApp.onEvent("fullscreenChanged", onFullscreenChanged)
  webApp.requestFullscreen()
  onFullscreenChanged()

  return () => webApp.offEvent("fullscreenChanged", onFullscreenChanged)
}
