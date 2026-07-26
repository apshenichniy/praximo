import type { ComponentProps } from "react"

import { cn } from "@/lib/utils.ts"

export function Section({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("mt-12", className)} {...props} />
}

/**
 * A group inside a screen — «Status», «About», «Sessions» — not the screen's own
 * name. It sat at `text-title`, the same step as the `h1` above it, which made
 * every card look like the start of a new page; one step down puts it clearly
 * under the title and clearly over the rows it introduces.
 */
export function SectionTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2 className={cn("px-1 text-heading font-semibold tracking-tight", className)} {...props} />
  )
}
