export interface ReducedMotionPreference {
  readonly matches: boolean
}

export function prefersReducedMotion(
  preference: ReducedMotionPreference | undefined = globalThis.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ),
): boolean {
  return preference?.matches ?? false
}
