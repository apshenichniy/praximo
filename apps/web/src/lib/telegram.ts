// The narrow slice of the Telegram Mini App `WebApp` global the app actually
// calls (full API: https://core.telegram.org/bots/webapps). Kept minimal on
// purpose — every method here is exercised by the fullscreen flow below; widen
// it only when a screen needs more.

import { APP_DARK_COLOR } from "@/lib/theme.ts"

export interface TelegramWebApp {
  /** Signed launch credential sent to the server for validation. */
  readonly initData: string
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
  /** Sets the native header and upper-overscroll color. */
  setHeaderColor: (color: string) => void
  /** Sets the native WebView background and lower-overscroll color. */
  setBackgroundColor: (color: string) => void
  /** Sets the native bottom bar and Android navigation-bar color. */
  setBottomBarColor: (color: string) => void
  /** Requests true fullscreen — Bot API 8.0; a no-op on older clients. */
  requestFullscreen: () => void
  readonly BackButton: TelegramBackButton
  onEvent: (eventType: string, handler: () => void) => void
  offEvent: (eventType: string, handler: () => void) => void
}

export interface TelegramBackButton {
  readonly isVisible: boolean
  show: () => TelegramBackButton
  hide: () => TelegramBackButton
  onClick: (handler: () => void) => TelegramBackButton
  offClick: (handler: () => void) => TelegramBackButton
}

declare global {
  interface Window {
    readonly Telegram?: { readonly WebApp?: TelegramWebApp }
  }
}

/** The host script that installs `window.Telegram.WebApp`. */
export const TELEGRAM_WEBAPP_SRC = "https://telegram.org/js/telegram-web-app.js"

let telegramWebAppPromise: Promise<TelegramWebApp | undefined> | undefined

/** Load Telegram's host SDK once and return its WebApp bridge when available. */
export const loadTelegramWebApp = (): Promise<TelegramWebApp | undefined> => {
  const existing = window.Telegram?.WebApp
  if (existing) return Promise.resolve(existing)

  telegramWebAppPromise ??= new Promise((resolve) => {
    const script = document.createElement("script")
    script.src = TELEGRAM_WEBAPP_SRC
    script.async = true
    script.dataset.praximoTelegramSdk = "true"
    script.addEventListener("load", () => resolve(window.Telegram?.WebApp), {
      once: true,
    })
    script.addEventListener("error", () => resolve(undefined), { once: true })
    document.head.appendChild(script)
  })

  return telegramWebAppPromise
}

export const readTelegramInitData = (webApp: TelegramWebApp | undefined): string | undefined => {
  const initData = webApp?.initData.trim()
  return initData ? initData : undefined
}

export const attachBackButton = (webApp: TelegramWebApp, onBack: () => void): (() => void) => {
  webApp.BackButton.onClick(onBack).show()

  return () => {
    webApp.BackButton.offClick(onBack).hide()
  }
}

/**
 * `requestFullscreen` and the `fullscreenChanged` event are Bot API 8.0
 * (mini-app.md, decided in #14). Below 8.0 the Mini App still `expand()`s but
 * cannot go fullscreen, so the request is skipped rather than firing an error
 * event into a client that can't honour it.
 */
export const FULLSCREEN_MIN_VERSION = "8.0"
export const CUSTOM_HEADER_COLOR_MIN_VERSION = "6.9"
export const BOTTOM_BAR_COLOR_MIN_VERSION = "7.10"

/**
 * Paint Telegram-owned surfaces before hiding its native loading placeholder.
 * The page stylesheet cannot reach the host header or its overscroll regions,
 * so these bridge calls must precede `ready()`.
 */
export const revealTelegramWebApp = (webApp: TelegramWebApp): void => {
  webApp.setBackgroundColor(APP_DARK_COLOR)

  if (webApp.isVersionAtLeast(CUSTOM_HEADER_COLOR_MIN_VERSION)) {
    webApp.setHeaderColor(APP_DARK_COLOR)
  }
  if (webApp.isVersionAtLeast(BOTTOM_BAR_COLOR_MIN_VERSION)) {
    webApp.setBottomBarColor(APP_DARK_COLOR)
  }

  webApp.ready()
  webApp.expand()
}

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
  revealTelegramWebApp(webApp)

  if (!webApp.isVersionAtLeast(FULLSCREEN_MIN_VERSION)) return undefined

  webApp.onEvent("fullscreenChanged", onFullscreenChanged)
  webApp.requestFullscreen()
  onFullscreenChanged()

  return () => webApp.offEvent("fullscreenChanged", onFullscreenChanged)
}
