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
  /**
   * Stops vertical swipes on the webview content from minimizing the Mini App
   * (BotFather-style) — Bot API 7.7. Swiping the native Telegram header still
   * minimizes or closes the app; that is host behavior and stays available.
   */
  disableVerticalSwipes: () => void
  /**
   * Opens the native chat picker to forward a bot-prepared inline message
   * (Bot API 8.0). `preparedMessageId` comes from `savePreparedInlineMessage`.
   * The optional callback reports whether the message was sent — `false` when
   * the manager dismisses the picker.
   */
  shareMessage: (preparedMessageId: string, callback?: (sent: boolean) => void) => void
  /** Opens a `t.me` link inside Telegram without closing the Mini App. */
  openTelegramLink: (url: string) => void
  readonly BackButton: TelegramBackButton
  readonly HapticFeedback?: {
    readonly notificationOccurred: (type: "error" | "success" | "warning") => void
  }
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

/**
 * Open a `t.me` link without leaving the Mini App. Outside a Telegram host
 * (local browser development) there is no bridge, so the link opens normally.
 */
export const openTelegramLink = async (link: string): Promise<void> => {
  const webApp = await loadTelegramWebApp()
  if (webApp === undefined) {
    window.open(link, "_blank", "noopener,noreferrer")
    return
  }
  webApp.openTelegramLink(link)
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
export const VERTICAL_SWIPES_MIN_VERSION = "7.7"

/**
 * Paint Telegram-owned surfaces and pin the swipe behavior before hiding the
 * native loading placeholder. The page stylesheet cannot reach the host header
 * or its overscroll regions, and CSS cannot reach the host swipe container
 * either, so these bridge calls must precede `ready()`. Pre-7.7 clients keep
 * the default swipe-to-minimize behavior — the method is never called there.
 */
export const revealTelegramWebApp = (webApp: TelegramWebApp): void => {
  webApp.setBackgroundColor(APP_DARK_COLOR)

  if (webApp.isVersionAtLeast(CUSTOM_HEADER_COLOR_MIN_VERSION)) {
    webApp.setHeaderColor(APP_DARK_COLOR)
  }
  if (webApp.isVersionAtLeast(BOTTOM_BAR_COLOR_MIN_VERSION)) {
    webApp.setBottomBarColor(APP_DARK_COLOR)
  }
  if (webApp.isVersionAtLeast(VERTICAL_SWIPES_MIN_VERSION)) {
    webApp.disableVerticalSwipes()
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

/** `WebApp.shareMessage` and the prepared-inline-message flow are Bot API 8.0. */
export const SHARE_MESSAGE_MIN_VERSION = "8.0"

export type ShareInviteOutcome = "shared" | "dismissed" | "fallback"

export interface ShareInviteOptions {
  /**
   * Mints a fresh, short-lived prepared inline message and yields its id. Called
   * lazily and only on 8.0+ hosts — prepared messages expire quickly, so the id
   * must be requested at share time, never ahead of it.
   */
  readonly prepare: () => Promise<string>
  /** The one-time onboarding deep link — the URL of the pre-8.0 share fallback. */
  readonly link: string
  /** The forwardable message body (ends with the link); the pre-8.0 fallback text. */
  readonly message: string
}

/**
 * Share a coach invite through Telegram. On Bot API 8.0+ this prepares a
 * bot-authored inline message and opens the native chat picker, so the coach
 * receives the bot's message with a working button. On older clients it falls
 * back to `t.me/share/url`, which sends the invite as the manager's own plain
 * text. The deep link is the URL and the prose (minus its trailing link) is the
 * text, so the link is not duplicated. Pure aside from the injected `webApp`.
 */
export const shareInviteMessage = async (
  webApp: TelegramWebApp,
  options: ShareInviteOptions,
): Promise<ShareInviteOutcome> => {
  if (!webApp.isVersionAtLeast(SHARE_MESSAGE_MIN_VERSION)) {
    const body = options.message.endsWith(options.link)
      ? options.message.slice(0, options.message.length - options.link.length).trimEnd()
      : options.message
    webApp.openTelegramLink(
      `https://t.me/share/url?url=${encodeURIComponent(options.link)}&text=${encodeURIComponent(body)}`,
    )
    return "fallback"
  }

  const preparedMessageId = await options.prepare()
  return new Promise<ShareInviteOutcome>((resolve) => {
    webApp.shareMessage(preparedMessageId, (sent) => resolve(sent ? "shared" : "dismissed"))
  })
}
