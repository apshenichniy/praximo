// The narrow slice of the Telegram Mini App `WebApp` global the app actually
// calls (full API: https://core.telegram.org/bots/webapps). Kept minimal on
// purpose — every method here is exercised by the fullscreen flow below; widen
// it only when a screen needs more.

import {
  APP_ON_PRIMARY_COLOR,
  APP_PRIMARY_COLOR,
  APP_SURFACE_COLOR,
  type ColorScheme,
} from "../theme.ts"

export interface TelegramWebApp {
  /** Signed launch credential sent to the server for validation. */
  readonly initData: string
  /** The Bot API version the host client implements, e.g. "8.0". */
  readonly version: string
  /** `ios`, `android`, `tdesktop`, `macos`, `weba`… — what is running us. */
  readonly platform: string
  /**
   * The client's own color scheme, derived by the host from its theme. The app
   * follows it rather than imposing one; `themeChanged` is how it moves.
   */
  readonly colorScheme: ColorScheme
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
  /**
   * Opens an external `https` link in Telegram's own in-app browser, which keeps
   * a back arrow to the Mini App (Bot API 6.1 for the options argument; the bare
   * call is older). `try_instant_view` is deliberately not passed — a legal text
   * read through a reader view is not the document we are asking somebody to
   * agree to.
   */
  openLink: (url: string, options?: { readonly try_instant_view?: boolean }) => void
  readonly BackButton: HostBackButton
  readonly MainButton: HostMainButton
  /**
   * The host's own haptics (Bot API 6.1). Absent on Desktop and on clients that
   * predate it, which is why every call goes through the guarded wrappers in
   * `features/mini-app/haptics.ts`.
   */
  readonly HapticFeedback?: {
    readonly impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void
    readonly notificationOccurred: (type: "error" | "success" | "warning") => void
    /** The tick a picker makes: one value in a set replacing another. */
    readonly selectionChanged: () => void
  }
  onEvent: (eventType: string, handler: () => void) => void
  offEvent: (eventType: string, handler: () => void) => void
}

export interface HostBackButton {
  readonly isVisible: boolean
  show: () => HostBackButton
  hide: () => HostBackButton
  onClick: (handler: () => void) => HostBackButton
  offClick: (handler: () => void) => HostBackButton
}

export interface HostMainButton {
  readonly isVisible: boolean
  setText: (text: string) => HostMainButton
  setParams: (params: { readonly color?: string; readonly text_color?: string }) => HostMainButton
  show: () => HostMainButton
  hide: () => HostMainButton
  onClick: (handler: () => void) => HostMainButton
  offClick: (handler: () => void) => HostMainButton
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

/**
 * Open an external page without stranding the coach outside the app (#191).
 *
 * The legal texts live at `me.praximo.io`, and a link out of a Mini App is the
 * thing `terms-screen.tsx` has always warned about: a coach ejected into the
 * system browser mid-onboarding is a coach who may not come back. `openLink`
 * answers exactly that — Telegram's own in-app browser opens over the Mini App,
 * with a back arrow that returns to it, and the app is still running underneath.
 *
 * Outside a Telegram host (a browser, local development) there is no bridge and
 * no problem to solve: the caller's own `href` handles it, which is why this
 * reports whether it took the link rather than opening a window itself. A page
 * that is already a page does not need to be re-opened.
 */
export const openExternalLink = (link: string): boolean => {
  if (typeof window === "undefined") return false
  // Read from the global synchronously rather than through
  // `loadTelegramWebApp`, for the reason `features/mini-app/haptics.ts` gives:
  // this is called from a click handler, and a decision that arrives a promise
  // later has already lost the event it was deciding about. By the time anything
  // on a screen can be tapped, the host script in `<head>` has long since run.
  const webApp = window.Telegram?.WebApp
  // Its presence is not enough — the SDK script is on every page. A signed
  // `initData` is what separates a real launch from a plain visit, the same test
  // `HostTheme` and `HostMainButton` make.
  if (webApp === undefined || !readTelegramInitData(webApp)) return false

  try {
    webApp.openLink(link)
    return true
  } catch {
    // A host too old for `openLink` throws. Reporting the failure lets the
    // anchor navigate, which is worse than an in-app browser and much better
    // than a link that does nothing.
    return false
  }
}

export const attachBackButton = (webApp: TelegramWebApp, onBack: () => void): (() => void) => {
  webApp.BackButton.onClick(onBack).show()

  return () => {
    webApp.BackButton.offClick(onBack).hide()
  }
}

/** `MainButton.setParams` is Bot API 6.1; the button itself predates it. */
export const MAIN_BUTTON_PARAMS_MIN_VERSION = "6.1"

/** `HapticFeedback` arrived in the same version as the button's parameters. */
export const HAPTIC_MIN_VERSION = "6.1"

/**
 * Paint the host's bottom button in the app's own palette for the scheme the
 * client is in. Inheriting the client's blue accent would make the one button
 * Telegram draws for us the only foreign thing on the screen; pre-6.1 hosts keep
 * their theme colors rather than being left with a button we styled halfway.
 * Called again whenever the scheme moves — the button outlives the change.
 */
export const applyMainButtonColors = (webApp: TelegramWebApp, scheme: ColorScheme): void => {
  if (!webApp.isVersionAtLeast(MAIN_BUTTON_PARAMS_MIN_VERSION)) return

  webApp.MainButton.setParams({
    color: APP_PRIMARY_COLOR[scheme],
    text_color: APP_ON_PRIMARY_COLOR[scheme],
  })
}

/**
 * Hand a screen's primary action to the host's own bottom button. It sits
 * outside the scroll area, so the action keeps one fixed place no matter how
 * much the list above it grows — which is the whole reason to prefer it to a
 * row inside the list.
 */
/**
 * How long the button waits, after its screen lets go, for the next screen to
 * take it.
 *
 * A route change unmounts one owner and mounts the next in the same frame, but
 * the new one has to await `loadTelegramWebApp()` first — a resolved promise, so
 * a microtask, yet still not synchronous. This has to outlast that and nothing
 * more: it is the delay before the button goes away on a screen that genuinely
 * has no action, and there it is imperceptible.
 */
const MainButtonHandoffMs = 80

let mainButtonOwner: symbol | undefined
let mainButtonHandoff: ReturnType<typeof setTimeout> | undefined
/** The button the wrapper is bound to, not merely *whether* it is bound. */
let mainButtonBoundTo: HostMainButton | undefined
const mainButtonHandler = { current: () => {} }
const invokeMainButton = () => mainButtonHandler.current()

/**
 * Take the host's bottom button for one screen, and hand it over rather than
 * give it back.
 *
 * There is exactly one of these buttons on the phone, and every screen that
 * wants it mounted its own component — so navigating from a screen with a button
 * to another screen with a button ran `hide()` and then `show()`, and the host
 * animates both. The button slid away and slid back on every route change, which
 * is the app announcing its own component tree.
 *
 * So ownership is a claim, not an attachment. Claiming cancels any pending
 * release, sets the label and the handler, and shows the button only if it is
 * not already up; releasing schedules the hide far enough out for the next
 * screen to cancel it. Button → button is now a `setText` and nothing else.
 *
 * The click handler is bound once for the page's lifetime and reads the current
 * owner's closure when it fires. Binding per claim would accumulate handlers on
 * a long session, and `offClick` cannot remove a closure nobody kept.
 */
export const claimMainButton = (
  webApp: TelegramWebApp,
  text: string,
  onClick: () => void,
): (() => void) => {
  const token = Symbol("main-button")

  if (mainButtonHandoff !== undefined) {
    clearTimeout(mainButtonHandoff)
    mainButtonHandoff = undefined
  }

  mainButtonOwner = token
  mainButtonHandler.current = onClick
  applyMainButtonColors(webApp, webApp.colorScheme)

  if (mainButtonBoundTo !== webApp.MainButton) {
    webApp.MainButton.onClick(invokeMainButton)
    mainButtonBoundTo = webApp.MainButton
  }

  webApp.MainButton.setText(text)
  // Re-showing a visible button is another animation in some clients, and the
  // handoff exists precisely to avoid those.
  if (!webApp.MainButton.isVisible) webApp.MainButton.show()

  return () => {
    // Somebody already took it: this owner has nothing left to release.
    if (mainButtonOwner !== token) return

    mainButtonHandoff = setTimeout(() => {
      mainButtonHandoff = undefined
      if (mainButtonOwner !== token) return
      mainButtonOwner = undefined
      webApp.MainButton.hide()
    }, MainButtonHandoffMs)
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
 * Paint the Telegram-owned surfaces — header, webview background, bottom bar —
 * in the app's surface color for a scheme. The page stylesheet reaches none of
 * them, which is why they are bridge calls; each is gated on the version that
 * introduced it, so an older client keeps its own chrome rather than a half-
 * painted one. Called on launch and again on every `themeChanged`.
 */
export const applyTelegramSurfaceColors = (webApp: TelegramWebApp, scheme: ColorScheme): void => {
  const surface = APP_SURFACE_COLOR[scheme]
  webApp.setBackgroundColor(surface)

  if (webApp.isVersionAtLeast(CUSTOM_HEADER_COLOR_MIN_VERSION)) {
    webApp.setHeaderColor(surface)
  }
  if (webApp.isVersionAtLeast(BOTTOM_BAR_COLOR_MIN_VERSION)) {
    webApp.setBottomBarColor(surface)
  }
}

/**
 * Follow the client's scheme for as long as the app is open: `themeChanged`
 * fires when the coach flips the setting — or when their phone crosses into
 * night — while the Mini App is still on screen. Returns an unsubscribe. The
 * event predates every version gate here, so there is nothing to gate it on.
 */
export const watchTelegramColorScheme = (
  webApp: TelegramWebApp,
  onScheme: (scheme: ColorScheme) => void,
): (() => void) => {
  const handler = () => onScheme(webApp.colorScheme)

  webApp.onEvent("themeChanged", handler)
  return () => webApp.offEvent("themeChanged", handler)
}

/**
 * Paint Telegram-owned surfaces and pin the swipe behavior before hiding the
 * native loading placeholder. CSS cannot reach the host swipe container any more
 * than it can reach the header, so these bridge calls must precede `ready()`.
 * Pre-7.7 clients keep the default swipe-to-minimize behavior — the method is
 * never called there.
 */
export const revealTelegramWebApp = (webApp: TelegramWebApp): void => {
  applyTelegramSurfaceColors(webApp, webApp.colorScheme)

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

/** The host client running us — `ios`, `android`, `tdesktop`, `weba`, `macos`… */
export const IOS_PLATFORM = "ios"

/**
 * Which client the Mini App is running inside, or `undefined` outside one.
 *
 * Read straight off the global rather than through `loadTelegramWebApp`, for the
 * reason `openExternalLink` gives: this decides what a screen *renders*, and an
 * answer that arrives a promise later has already drawn the wrong thing. By the
 * time any screen paints, the host script `__root.tsx` puts in `<head>` has run.
 */
export const hostPlatform = (): string | undefined =>
  typeof window === "undefined" ? undefined : window.Telegram?.WebApp?.platform

/**
 * Whether the system share sheet is worth offering (#27, #224).
 *
 * **Gated on the platform, deliberately, and not on `navigator.share`.** Feature
 * detection is wrong on three of the four hosts: Android's WebView has no
 * `navigator.share` at all, both Telegram Web clients expose it and then refuse
 * by Permissions Policy, and Desktop's WebView2 resolves and does nothing. Only
 * iOS both advertises the API and honours it, so iOS is what this asks about.
 */
export const isIosHost = (): boolean => hostPlatform() === IOS_PLATFORM

export type SystemShareOutcome = "shared" | "dismissed" | "unsupported"

/**
 * Hand text to the operating system's own share sheet.
 *
 * A cancelled sheet rejects with `AbortError`, which is a coach changing their
 * mind rather than a failure — the caller tells the two apart because only one
 * of them is a delivery worth recording (#224).
 */
export const shareViaSystem = async (text: string): Promise<SystemShareOutcome> => {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return "unsupported"
  }
  try {
    await navigator.share({ text })
    return "shared"
  } catch (cause) {
    return cause instanceof Error && cause.name === "AbortError" ? "dismissed" : "unsupported"
  }
}
