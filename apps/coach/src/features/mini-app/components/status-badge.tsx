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

/**
 * Every tone but `muted` is one of the four status families in the Praximo
 * extension layer, and `destructive` is drawn from `error` for that reason.
 *
 * It used to read `bg-destructive-surface`, which is not a class. `@theme
 * inline` maps `--color-destructive` and nothing beside it — the baseline
 * shadcn token is a single colour, while `success`, `warning`, `error` and
 * `info` each carry a `-surface` and a `-border` because they were added *for*
 * this: a tinted pill that states a standing. So Tailwind generated nothing and
 * the badge rendered red text on no fill, alone among the five.
 *
 * `error` rather than a new `--destructive-surface`, because inventing one would
 * duplicate a family that already exists and is already tuned for both themes.
 * The ink shifts by a hair in doing so — `--destructive` is `oklch(0.577 0.245
 * 27.325)` in light against `--error`'s `oklch(0.569 0.204 23.849)` — and that
 * is the correct direction: a badge says what something *is*, not what a tap
 * would do, and shadcn's `destructive` is the vocabulary of the second.
 *
 * The tone keeps its name. It is the word callers already reach for, and
 * renaming it would move a union through both apps for a gain the comment makes
 * anyway.
 */
const toneClass: Record<StatusTone, string> = {
  success: "bg-success-surface text-success",
  warning: "bg-warning-surface text-warning",
  info: "bg-info-surface text-info",
  destructive: "bg-error-surface text-error",
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
