import { HAPTIC_MIN_VERSION, type TelegramWebApp } from "@/lib/telegram.ts"

/**
 * The host's haptics, guarded (#186).
 *
 * On a phone this is the channel that carries the most for the least: a tick
 * under the thumb says "heard you" more convincingly than any easing curve, and
 * it is the one feedback that still works for a coach who has turned animations
 * off.
 *
 * Read from the global synchronously rather than through `loadTelegramWebApp`,
 * because a haptic that arrives a promise later has missed the tap it describes.
 * By the time anything on a screen can be pressed, the host script in `<head>`
 * has long since run; before that, and outside Telegram entirely, every function
 * here is a silent no-op.
 */
const feedback = (): TelegramWebApp["HapticFeedback"] | undefined => {
  if (typeof window === "undefined") return undefined
  const webApp = window.Telegram?.WebApp
  if (webApp === undefined || !webApp.isVersionAtLeast(HAPTIC_MIN_VERSION)) return undefined
  return webApp.HapticFeedback
}

/**
 * One value in a set replacing another: a day on the strip, a duration chip, a
 * slot, a session kind.
 *
 * Called on the press, never on the answer — and never for a tap that chose what
 * was already chosen, because that is not a selection.
 */
export const selectionHaptic = (): void => {
  feedback()?.selectionChanged()
}

/**
 * A control that opens or closes something. `light` deliberately: this is
 * punctuation, not an event.
 */
export const impactHaptic = (
  style: "light" | "medium" | "heavy" | "rigid" | "soft" = "light",
): void => {
  feedback()?.impactOccurred(style)
}

/** An outcome — the session was booked, or the server refused it. */
export const notifyHaptic = (type: "error" | "success" | "warning"): void => {
  feedback()?.notificationOccurred(type)
}
