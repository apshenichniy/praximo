import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "../lib/utils.ts"
import type { FeedbackEvent } from "../lib/feedback.ts"
import { useFeedback } from "./feedback-provider.tsx"

/**
 * One segment in a row that switches which view you are looking at.
 *
 * **The difference from `ChoiceChip` is semantic, not dimensional**, which is
 * why this is a sibling rather than a size variant. A chip answers a question
 * the screen is asking — the invitation language, the session duration, a slot
 * — and its answer is written down. A segment changes what the panel beside it
 * is showing and writes nothing; the client screen's two invitation doors are
 * two forms of one token, both valid since the invitation existed.
 *
 * The looks follow from that. A chip at rest is `bg-secondary` under
 * `border-border` and selected is a violet fill, because picking one is the
 * screen's business. A segment gets the chip's *resting* look as its **selected**
 * state and nothing at all when it is not: a control that only changes the view
 * must never outrank the action it sits beside. On the client screen it did —
 * 44px and violet, against a 36px primary button.
 *
 * **Both themes carry it, by different means.** In dark, `--secondary` is one
 * clean step above `--card`, so the fill does the work and the border is a
 * highlight. In light the pair is `#f4f4f5` on `#ffffff` and the fill is nearly
 * nothing, so `border-border` is what says «selected». Neither theme is given a
 * value of its own — this is the same two classes reading differently, which is
 * the property that made a quiet segment possible without a new token.
 *
 * Smaller than the 44px target the rest of the screen holds to, deliberately:
 * switching is free and reversible, and a control that writes nothing does not
 * earn the same footprint as one that does. Do not reach for this where the
 * choice is recorded — that is `ChoiceChip`, and it should stay loud.
 *
 * The container is the caller's, as with `ChoiceChip`. What is shared is what a
 * segment looks like, what it announces, and what it feels like.
 */
const segmentedChoiceVariants = cva(
  [
    "flex items-center justify-center border font-medium whitespace-nowrap",
    "ease-[var(--ease-out)] transition-[color,background-color,border-color] duration-100",
    "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      size: {
        default: "min-h-8 rounded-full px-3.5 text-sm leading-normal",
        /** A card's header strip, where the segment is chrome around a body. */
        sm: "min-h-7.5 rounded-full px-3 text-xs leading-normal",
      },
      selected: {
        true: "bg-secondary border-border text-foreground font-semibold",
        false: "bg-transparent border-transparent text-muted-foreground",
      },
    },
    defaultVariants: { size: "default", selected: false },
  },
)

export type SegmentedChoiceProps = Omit<ComponentProps<"button">, "type"> &
  Omit<VariantProps<typeof segmentedChoiceVariants>, "selected"> & {
    readonly selected: boolean
    /**
     * Defaults to `selection` — the same discrete-choice event `ChoiceChip`
     * fires. Pass `false` where a screen fires its own.
     */
    readonly feedback?: FeedbackEvent | false
  }

export function SegmentedChoice({
  className,
  selected,
  size,
  feedback = "selection",
  onClick,
  ...props
}: SegmentedChoiceProps) {
  const adapter = useFeedback()
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(segmentedChoiceVariants({ size, selected, className }))}
      onClick={(event) => {
        // Only where the tap changes the view. Buzzing at the segment already
        // showing makes the row feel like it did something when it did not.
        if (feedback !== false && !selected) adapter.emit(feedback)
        onClick?.(event)
      }}
      {...props}
    />
  )
}
