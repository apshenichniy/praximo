import type { TelegramWebApp } from "@/lib/telegram.ts"

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
  // The object's own presence is the test, not the version it claims: a host
  // that ships `HapticFeedback` can perform one, and a host that does not
  // cannot, whatever `isVersionAtLeast` says about it.
  return window.Telegram?.WebApp?.HapticFeedback
}

/**
 * Never let a tick take a tap down with it. The bridge throws on some hosts for
 * a method they do not implement, and a haptic is the least important thing
 * happening in that handler.
 */
const fire = (perform: (feedback: NonNullable<TelegramWebApp["HapticFeedback"]>) => void): void => {
  const bridge = feedback()
  if (bridge === undefined) return
  try {
    perform(bridge)
  } catch {
    // A host that cannot buzz is not a failure anybody needs to hear about.
  }
}

/**
 * One value in a set replacing another: a day on the strip, a duration chip, a
 * slot, a session kind.
 *
 * Called on the press, never on the answer — and never for a tap that chose what
 * was already chosen, because that is not a selection.
 */
export const selectionHaptic = (): void => {
  fire((bridge) => bridge.selectionChanged())
}

/**
 * A control that opens or closes something. `light` deliberately: this is
 * punctuation, not an event.
 */
export const impactHaptic = (
  style: "light" | "medium" | "heavy" | "rigid" | "soft" = "light",
): void => {
  fire((bridge) => bridge.impactOccurred(style))
}

/** An outcome — the session was booked, or the server refused it. */
export const notifyHaptic = (type: "error" | "success" | "warning"): void => {
  fire((bridge) => bridge.notificationOccurred(type))
}

/** What the host says about itself, for the probe on the Main Mini App screen. */
export const hapticSupport = (): {
  readonly host: string
  readonly version: string
  readonly platform: string
  readonly available: boolean
} => {
  const webApp = typeof window === "undefined" ? undefined : window.Telegram?.WebApp
  return {
    host: webApp === undefined ? "none" : "telegram",
    version: webApp?.version ?? "—",
    platform: webApp?.platform ?? "—",
    available: webApp?.HapticFeedback !== undefined,
  }
}
