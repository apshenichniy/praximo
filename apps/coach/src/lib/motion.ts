/**
 * The motion contract's JavaScript half (docs/spec/mini-app.md §Motion).
 *
 * Almost everything that moves in this app moves in CSS, where it runs off the
 * main thread and survives a busy render. What is left are the things CSS has no
 * property for — scroll position, chiefly — and those need to ask the same
 * question the stylesheet asks: does this coach want movement at all?
 */

/**
 * Whether the coach has asked for less movement.
 *
 * Read per call rather than cached: the setting can change while the Mini App is
 * open, and this is one `matchMedia` on a tap, not in a frame loop.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * What to hand `scrollTo` — animated, unless movement is unwelcome.
 *
 * Reduced motion means *fewer and gentler*, not none: a jump to the right place
 * still communicates, it just does not travel there.
 */
export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? "auto" : "smooth")
