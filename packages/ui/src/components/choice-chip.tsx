import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "../lib/utils.ts"
import type { FeedbackEvent } from "../lib/feedback.ts"
import { useFeedback } from "./feedback-provider.tsx"

/**
 * One chip in a pick-exactly-one row.
 *
 * It exists because the product had already written it four times by hand —
 * the invitation language on New client, the session duration and the slot grid
 * on Scheduling, and the Admin section's invite chips — with the class string
 * copied between them and drifting. Three *other* places asked the same question
 * through `ToggleGroup` and got a different, weaker answer: a pale
 * `data-[state=on]:bg-muted` that reads as a smudge rather than as a choice.
 *
 * **A Praximo composite, not a primitive variant** (`docs/agents/ui-development.md`).
 * The contract forbids adding product visual variants inside
 * `components/ui/**`, and forbids `className` on a primitive from overriding its
 * colours — which is exactly what a violet-filled `ToggleGroupItem` would have
 * to do. So the look lives here, one layer up, beside `FeedbackButton`.
 *
 * **A control at rest is a fill *and* an edge** (#198). The unselected chip
 * carries `bg-secondary` under `border-border`; an earlier version put the whole
 * affordance on a hairline at 1.22:1 against the page.
 *
 * The **container is the caller's** — these appear in a `flex` row with `flex-1`
 * chips and in a slot grid — and so is the option list. What is shared is what
 * a chip looks like, what it announces, and what it feels like.
 */
const choiceChipVariants = cva(
  [
    "flex items-center justify-center border font-semibold",
    "ease-[var(--ease-out)] transition-[color,background-color,border-color,scale] duration-100",
    "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      size: {
        default: "min-h-11 rounded-full py-2 text-base leading-relaxed active:scale-[0.97]",
        /** The slot grid: many per row, so a tighter target and a softer corner. */
        sm: "min-h-10 rounded-lg text-sm leading-normal active:scale-[0.96]",
      },
      selected: {
        true: "bg-primary text-primary-foreground border-transparent",
        false: "bg-secondary border-border text-foreground",
      },
    },
    defaultVariants: { size: "default", selected: false },
  },
)

export type ChoiceChipProps = Omit<ComponentProps<"button">, "type"> &
  Omit<VariantProps<typeof choiceChipVariants>, "selected"> & {
    readonly selected: boolean
    /**
     * Defaults to `selection`, the event this gesture is: a discrete choice, not
     * an impact. Pass `false` where a screen fires its own.
     */
    readonly feedback?: FeedbackEvent | false
  }

export function ChoiceChip({
  className,
  selected,
  size,
  feedback = "selection",
  onClick,
  ...props
}: ChoiceChipProps) {
  const adapter = useFeedback()
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(choiceChipVariants({ size, selected, className }))}
      onClick={(event) => {
        // Only on a chip that actually changes something. Tapping the chip you
        // are already on is not a selection, and buzzing at it makes the row
        // feel like it did something when it did not.
        if (feedback !== false && !selected) adapter.emit(feedback)
        onClick?.(event)
      }}
      {...props}
    />
  )
}
