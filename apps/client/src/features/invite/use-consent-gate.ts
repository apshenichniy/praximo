import { useEffect, useRef, useState } from "react"

/**
 * The commit stays unreachable until the last consent point has been **on
 * screen** (#57).
 *
 * The rule is that the text must have *been visible*, not that the reader must
 * have scrolled for its own sake — so a pane whose content already fits unlocks
 * immediately, and on a tall screen the button is active on arrival. That is
 * correct and the ticket says so explicitly, because the first person to open
 * the page on a large monitor will otherwise file it as a bug. Measured on the
 * design mockups: the consent column overflows by 28px at 1280 × 800 and 108px
 * at 1280 × 720, and fits entirely at 1280 × 900.
 *
 * `IntersectionObserver` rather than a scroll listener: a sentinel that starts
 * inside the viewport fires on the observer's *first* callback, which is exactly
 * the already-fits case, and no arithmetic about scroll heights has to be right
 * for it to work.
 */

/** Just enough of the browser's observer to wire and to fake. */
export interface GateObserver {
  observe: (target: Element) => void
  disconnect: () => void
}

export type GateObserverFactory = (
  callback: (entries: ReadonlyArray<{ readonly isIntersecting: boolean }>) => void,
) => GateObserver

/**
 * The gate, with React taken out of it so the behaviour can be exercised in
 * Node: the app's tests run without a DOM, and the two things worth pinning here
 * — an already-visible sentinel unlocking, and a browser without an observer not
 * locking anybody out — are both about wiring rather than rendering.
 *
 * Unlocking is **one-way**: the observer disconnects on the first intersection.
 * Scrolling back up does not re-disable the button. The point is that the text
 * was read, and a commit that came and went as the page moved would read as a
 * bug rather than as a gate.
 */
export const watchConsentGate = (
  sentinel: Element | null,
  onUnlock: () => void,
  factory: GateObserverFactory | undefined,
): (() => void) => {
  // No sentinel, or no observer in this browser: unlock. A client whose browser
  // cannot observe must not be locked out of accepting — the gate is a reading
  // aid, not an authorization check, and the consent text is on the page either
  // way. Refusing here would deny somebody their coach over a missing API.
  if (sentinel === null || factory === undefined) {
    onUnlock()
    return () => {}
  }

  // Guarded rather than relying on `disconnect()` to be the last word: an
  // observer may deliver a batch that was already queued when it was
  // disconnected, and unlocking twice would set state on an unmounted component.
  let done = false
  const observer = factory((entries) => {
    if (done || !entries.some((entry) => entry.isIntersecting)) return
    done = true
    onUnlock()
    observer.disconnect()
  })
  observer.observe(sentinel)
  return () => observer.disconnect()
}

export const useConsentGate = (): {
  readonly unlocked: boolean
  readonly sentinelRef: React.RefObject<HTMLDivElement | null>
} => {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [unlocked, setUnlocked] = useState(false)

  useEffect(
    () =>
      watchConsentGate(
        sentinelRef.current,
        () => setUnlocked(true),
        typeof IntersectionObserver === "undefined"
          ? undefined
          : (callback) => new IntersectionObserver(callback),
      ),
    [],
  )

  return { unlocked, sentinelRef }
}
