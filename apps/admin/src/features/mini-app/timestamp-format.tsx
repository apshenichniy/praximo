import { createContext, type ReactNode, use } from "react"

/**
 * How a surface writes a moment — the two lines {@link TimestampValue} renders.
 *
 * A parameter rather than an import, because the primitive is shared and the
 * answer is not: the admin surface is English-only and pins `en-GB`, while every
 * coach screen writes in `member.language`. A primitive that formatted for
 * itself would carry one of those two into the other.
 */
export interface TimestampFormat {
  /** "2 days ago" — including whatever this surface calls the last minute. */
  readonly relative: (value: string) => string
  /** The exact moment, underneath. */
  readonly absolute: (value: string) => string
}

const TimestampFormatContext = createContext<TimestampFormat | undefined>(undefined)

/**
 * Supplies the format for a screen.
 *
 * **Where the value comes from is the route's business, not this file's.** The
 * owner is the router's typed route context — the app's existing DI seam — so a
 * loader can format too, which is what a needs-attention section computed before
 * paint will want (#61). This provider only carries the answer down to the
 * primitives, so `features/mini-app` never has to know the shape of the route
 * tree.
 */
export function TimestampFormatProvider({
  value,
  children,
}: {
  readonly value: TimestampFormat
  readonly children: ReactNode
}) {
  return <TimestampFormatContext value={value}>{children}</TimestampFormatContext>
}

/**
 * Throws rather than falling back when no provider is above it.
 *
 * A default would mean a screen that silently renders somebody else's language —
 * the exact failure #130 spent a ticket repairing. Failing at first render puts
 * it in front of whoever added the screen.
 */
export const useTimestampFormat = (): TimestampFormat => {
  const format = use(TimestampFormatContext)
  if (format === undefined) {
    throw new Error(
      "TimestampValue needs a <TimestampFormatProvider> above it — a surface has to say which language it writes moments in.",
    )
  }
  return format
}
