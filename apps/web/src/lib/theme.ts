/**
 * The app's two color schemes, and the one place that decides which is on.
 *
 * Praximo follows the Telegram client rather than imposing a scheme of its own:
 * a coach who reads their phone in light mode should not meet one black
 * rectangle inside it. `WebApp.colorScheme` is the answer while the app runs and
 * `themeChanged` is how it moves; outside a Telegram host the browser's
 * `prefers-color-scheme` stands in for both.
 */

export type ColorScheme = "light" | "dark"

/**
 * How a scheme is expressed to CSS: the `dark` class on `<html>`, which is both
 * the ground `styles/app.css` overrides `:root` with and the switch Tailwind's
 * own `dark:` variants read. Light is the absence of it — `:root` alone.
 */
export const DARK_SCHEME_CLASS = "dark"

export interface SchemeColor {
  readonly light: string
  readonly dark: string
}

/**
 * The surface color at the boundaries that require hexadecimal RGB: the initial
 * browser paint, the Telegram host chrome (header, background, bottom bar), and
 * the `theme-color` meta. The dark value is also the native splash screen's,
 * configured separately in BotFather — Telegram takes one color there, not a
 * pair, so the splash stays dark whatever the client is set to.
 */
export const APP_SURFACE_COLOR: SchemeColor = { dark: "#181821", light: "#ffffff" }

/**
 * The page's own ground, in hex, for the pre-oklch fallback in critical CSS.
 * The light one is not white: the page recedes so that cards and sheets have
 * something to be raised against (#195) — `styles/app.css` §`:root`.
 */
export const APP_BACKGROUND_COLOR: SchemeColor = { dark: "#0a0a10", light: "#f3f3f6" }

/** Running text on that ground, for the same fallback. */
export const APP_FOREGROUND_COLOR: SchemeColor = { dark: "#f1f2f5", light: "#101018" }

/**
 * The primary button pair, for the same hexadecimal-only boundaries — the host
 * bottom button is styled through a bridge call, not CSS. Keep in step with
 * `--primary` / `--primary-foreground` in `styles/app.css`, which are authored
 * in oklch and cannot be handed to Telegram as they are. The two schemes invert
 * each other: a near-white button on dark, a near-black one on light.
 */
export const APP_PRIMARY_COLOR: SchemeColor = { dark: "#b488ff", light: "#9324ff" }
export const APP_ON_PRIMARY_COLOR: SchemeColor = { dark: "#10101b", light: "#fcfcfe" }

/**
 * The scheme, decided before the first paint.
 *
 * It cannot be decided on the server: Telegram publishes the client's theme as
 * `tgWebAppThemeParams` in the URL **hash**, which no request ever carries. So
 * the document is rendered scheme-less and this runs as a blocking script in
 * `<head>`, ahead of the body — which is why it is a string of plain ES5 rather
 * than a module: it must execute before anything is fetched, parsed or painted.
 *
 * `bg_color` is the same signal Telegram's own SDK derives `colorScheme` from —
 * the perceived luminance of the client's background. Anything unparseable, and
 * every launch outside Telegram, falls through to the browser's own preference;
 * a launch where even that is unavailable keeps the dark the app shipped with.
 *
 * Evaluated by `lib/theme.test.ts` against fake globals, so the logic in here is
 * covered rather than merely inspected.
 */
export const COLOR_SCHEME_BOOTSTRAP = `!function () {
  try {
    var scheme
    try {
      var params = /[#&]tgWebAppThemeParams=([^&]*)/.exec(location.hash)
      var background = params && JSON.parse(decodeURIComponent(params[1])).bg_color
      if (typeof background === "string" && /^#?[0-9a-f]{6}$/i.test(background.trim())) {
        var rgb = background.trim().replace("#", "")
        var luminance = 0.2126 * parseInt(rgb.slice(0, 2), 16) +
          0.7152 * parseInt(rgb.slice(2, 4), 16) +
          0.0722 * parseInt(rgb.slice(4, 6), 16)
        scheme = luminance > 128 ? "light" : "dark"
      }
    } catch (unreadable) {
      // A launch we cannot read is not a launch in the dark; fall through.
    }
    if (!scheme && window.matchMedia) {
      scheme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
    }
    document.documentElement.classList.toggle("${DARK_SCHEME_CLASS}", scheme !== "light")
  } catch (error) {
    document.documentElement.classList.add("${DARK_SCHEME_CLASS}")
  }
}()`

/** The scheme currently on the document — what the bootstrap above settled on. */
export const readColorScheme = (): ColorScheme =>
  document.documentElement.classList.contains(DARK_SCHEME_CLASS) ? "dark" : "light"

/**
 * Put a scheme on the document: the class every token hangs off, and the
 * `theme-color` meta the browser paints its own chrome with. Telegram's chrome
 * is not CSS and is repainted through the bridge instead — see
 * `applyTelegramSurfaceColors` in `lib/telegram.ts`.
 */
export const applyColorScheme = (scheme: ColorScheme): void => {
  document.documentElement.classList.toggle(DARK_SCHEME_CLASS, scheme === "dark")

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = APP_SURFACE_COLOR[scheme]
}

/**
 * Follow the browser's own preference, for every launch that is not a Telegram
 * one — the acceptance page in a client's browser, and local development.
 * Returns an unsubscribe.
 */
export const watchPreferredColorScheme = (
  onScheme: (scheme: ColorScheme) => void,
): (() => void) => {
  const query = window.matchMedia("(prefers-color-scheme: light)")
  const handler = () => onScheme(query.matches ? "light" : "dark")

  query.addEventListener("change", handler)
  return () => query.removeEventListener("change", handler)
}
