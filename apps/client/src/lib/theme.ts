/**
 * The app's two colour schemes, and the one place that decides which is on.
 *
 * The Mini App has a host to follow — a coach's Telegram client already knows
 * which scheme they are in, and the Telegram host adapter reads it.
 * This app has no host. A client meets it once, in their own browser, so the
 * decision belongs to them: the browser's `prefers-color-scheme` by default, and
 * an explicit choice in the footer when the default is wrong for them.
 *
 * Three states, not two. **System** is a real answer and the one most readers
 * want — a phone that goes dark at sunset should take this page with it — so it
 * is stored as itself rather than being collapsed into whichever scheme happened
 * to be on when the choice was made.
 */

export type ColorScheme = "light" | "dark"

/** What the reader asked for, which is not the same as what is on screen. */
export type ThemePreference = "system" | ColorScheme

/**
 * How a scheme is expressed to CSS: the `dark` class on `<html>`, which is both
 * the ground `styles/app.css` overrides `:root` with and the switch Tailwind's
 * own `dark:` variants read. Light is the absence of it — `:root` alone.
 */
export const DARK_SCHEME_CLASS = "dark"

/**
 * Where the choice is kept. `localStorage` rather than a cookie because nothing
 * on the server needs to know: the document is rendered scheme-less and the
 * bootstrap below settles it before the first paint, so a cookie would buy a
 * round trip's worth of nothing and add a header to every request from a page
 * whose whole point is that it carries no state about the reader.
 */
export const THEME_STORAGE_KEY = "praximo.theme"

export interface SchemeColor {
  readonly light: string
  readonly dark: string
}

/**
 * The colour a plain browser paints its own chrome with, through the
 * `theme-color` meta. Hexadecimal because that is what the meta takes; it cannot
 * read a token.
 *
 * **It is the page's colour, not the card's** (#198) — the chrome borders the
 * page, and anything else shows as a band of the wrong colour above the content
 * when an overscroll pulls it into view.
 *
 * Written by `docs/spec/design-system/apply.py`, together with the same constant
 * in the Telegram-hosted apps.
 */
export const APP_SURFACE_COLOR: SchemeColor = { dark: "#18181b", light: "#ffffff" }

/**
 * The page's own ground, in hex, for the pre-oklch fallback in critical CSS.
 * The light one is not white: the page recedes so that cards and sheets have
 * something to be raised against (#195) — `styles/app.css` §`:root`.
 */
export const APP_BACKGROUND_COLOR: SchemeColor = { dark: "#18181b", light: "#ffffff" }

/** Running text on that ground, for the same fallback. */
export const APP_FOREGROUND_COLOR: SchemeColor = { dark: "#fafafa", light: "#18181b" }

/**
 * The scheme, decided before the first paint.
 *
 * A blocking script in `<head>`, ahead of the body, which is why it is a string
 * of plain ES5 rather than a module: it must execute before anything is fetched,
 * parsed or painted. A page that hydrated into the right scheme would still have
 * shown the wrong one first, and on a legal text that flash is the whole screen.
 *
 * The order is the reader's: an explicit `light` or `dark` they chose wins over
 * the browser's preference, because they chose it *knowing* what the browser
 * said. `system`, a corrupt value, a storage that throws (Safari in private
 * browsing does) and a browser without `matchMedia` all fall through to the same
 * place — the light ground the stylesheet already defaults to. Light rather than
 * dark on purpose: this is the scheme `:root` carries with no class at all, so
 * the failure mode is the document doing nothing rather than the document
 * guessing.
 *
 * Evaluated by `lib/theme.test.ts` against fake globals, so the logic in here is
 * covered rather than merely inspected.
 */
export const THEME_BOOTSTRAP = `!function () {
  try {
    var stored
    try {
      stored = window.localStorage.getItem("${THEME_STORAGE_KEY}")
    } catch (unreadable) {
      // Private browsing, a blocked origin, a disabled store. Not a failure.
    }
    var scheme = stored === "light" || stored === "dark" ? stored : undefined
    if (!scheme && window.matchMedia) {
      scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    }
    document.documentElement.classList.toggle("${DARK_SCHEME_CLASS}", scheme === "dark")
  } catch (error) {
    // Leave the document as it was rendered — :root is the light scheme.
  }
}()`

/** The scheme currently on the document — what the bootstrap above settled on. */
export const readColorScheme = (): ColorScheme =>
  document.documentElement.classList.contains(DARK_SCHEME_CLASS) ? "dark" : "light"

/**
 * What the reader has chosen, or `system` when they have not chosen — which is
 * also what a store that cannot be read reports, because a preference nobody can
 * retrieve is a preference nobody expressed.
 */
export const readThemePreference = (): ThemePreference => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === "light" || stored === "dark" ? stored : "system"
  } catch {
    return "system"
  }
}

/**
 * Record a choice. `system` clears the key rather than storing the word: the
 * absence of a preference is exactly what `system` means, and the bootstrap
 * reads it that way with one fewer branch.
 */
export const writeThemePreference = (preference: ThemePreference): void => {
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // A choice we cannot persist still applies to this page, which is most of
    // what it was for.
  }
}

/**
 * The browser's own answer. Not exported: `resolveColorScheme` below is the only
 * thing that should ever ask, because asking directly is how a caller ends up
 * following the browser past a choice the reader made.
 */
const preferredColorScheme = (): ColorScheme =>
  typeof window !== "undefined" &&
  window.matchMedia !== undefined &&
  window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"

/** What a preference resolves to right now. */
export const resolveColorScheme = (preference: ThemePreference): ColorScheme =>
  preference === "system" ? preferredColorScheme() : preference

/**
 * Put a scheme on the document: the class every token hangs off, and the
 * `theme-color` meta the browser paints its own chrome with.
 */
export const applyColorScheme = (scheme: ColorScheme): void => {
  document.documentElement.classList.toggle(DARK_SCHEME_CLASS, scheme === "dark")

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = APP_SURFACE_COLOR[scheme]
}

/**
 * Follow the browser's own preference while the page is open — a phone crossing
 * into night with a legal text still on screen. Returns an unsubscribe.
 */
export const watchPreferredColorScheme = (
  onScheme: (scheme: ColorScheme) => void,
): (() => void) => {
  const query = window.matchMedia("(prefers-color-scheme: dark)")
  const handler = () => onScheme(query.matches ? "dark" : "light")

  query.addEventListener("change", handler)
  return () => query.removeEventListener("change", handler)
}
