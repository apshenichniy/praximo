/**
 * The shared dark surface color at boundaries that require hexadecimal RGB:
 * initial browser paint, Telegram host chrome, and the native splash screen
 * configured separately in BotFather.
 */
export const APP_DARK_COLOR = "#191c1d"

/**
 * The primary button pair, for the same hexadecimal-only boundaries — the host
 * bottom button is styled through a bridge call, not CSS. Keep in step with
 * `--primary` / `--primary-foreground` in `styles/app.css`, which are authored
 * in oklch and cannot be handed to Telegram as they are.
 */
export const APP_PRIMARY_COLOR = "#e3e7e8"
export const APP_ON_PRIMARY_COLOR = "#161b1d"
