import type { ReactNode } from "react"

import { cn } from "@praximo/ui"

/**
 * A state, said once, at the top of the screen it is about (#198).
 *
 * **Where this belongs, and where it does not.** In a list the state stays a
 * coloured word: a badge in every row puts a border and a radius on every row,
 * and a list is read by scanning, which borders slow down. A hero is the
 * opposite case — one subject, one state, and nothing else competing — and there
 * the coloured line under the name read as a third paragraph rather than as the
 * client's standing. That is the whole rule: **badge in a hero, word in a row.**
 *
 * Quiet by construction. The fill is the status token's own surface and the ink
 * is the status colour, so there is no border and no new token: a tinted pill is
 * already distinct from running text, and adding an outline would make it the
 * loudest thing on a screen whose loudest thing should be the name.
 *
 * The dot stays inside it. Colour alone is not a signal everyone receives, and
 * the dot is the second channel — shape rather than hue — that survives both
 * colour blindness and a phone in sunlight.
 */
export type StatusTone = "success" | "warning" | "info" | "destructive" | "muted"

const toneClass: Record<StatusTone, string> = {
  success: "bg-success-surface text-success",
  warning: "bg-warning-surface text-warning",
  info: "bg-info-surface text-info",
  destructive: "bg-destructive-surface text-destructive",
  muted: "bg-muted text-muted-foreground",
}

export function StatusBadge({
  tone,
  children,
  className,
  dot = true,
}: {
  readonly tone: StatusTone
  readonly children: ReactNode
  readonly className?: string
  /**
   * Off where the badge already carries an icon — the icon is the same second
   * channel, and a dot beside it is two marks saying one thing.
   */
  readonly dot?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs leading-normal font-semibold",
        toneClass[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  )
}
