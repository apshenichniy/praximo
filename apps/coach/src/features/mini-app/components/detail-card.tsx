import type { ReactNode } from "react"

import { Card } from "@praximo/ui/components/card"
import { useTimestampFormat } from "@/features/mini-app/timestamp-format.tsx"
import { cn } from "@praximo/ui"

/**
 * The flush key/value surface both details variants are built from: rows divide
 * a single card, each one a label on the left and its value on the right. It is
 * the same reading rhythm as the coaches list — one line, one fact — so moving
 * between the two screens never asks the eye to re-learn the layout.
 */
export function DetailCard({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <Card className={cn("mt-4 gap-0 overflow-hidden py-0", className)}>
      <dl className="divide-border divide-y">{children}</dl>
    </Card>
  )
}

export function DetailRow({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-5 px-5 py-3">
      <dt className="text-muted-foreground text-base leading-relaxed">{label}</dt>
      <dd className="min-w-0 text-right text-base leading-relaxed font-medium">{children}</dd>
    </div>
  )
}

/**
 * A moment, read twice: the relative time answers "is this recent?" at a glance
 * and the absolute date underneath answers "when exactly?" without a tap.
 *
 * The words come from the surface, through {@link useTimestampFormat} — this is
 * the two-line layout and nothing else.
 */
export function TimestampValue({
  value,
  empty,
}: {
  readonly value: string | undefined
  readonly empty: string
}) {
  const format = useTimestampFormat()
  if (value === undefined) return <span className="text-muted-foreground font-normal">{empty}</span>
  return (
    <span className="flex flex-col items-end">
      <span>{format.relative(value)}</span>
      <span className="text-muted-foreground text-xs leading-normal font-normal">
        {format.absolute(value)}
      </span>
    </span>
  )
}

/** A value the surface deliberately does not have yet — never a zero (#113). */
export function PlaceholderValue({ children }: { readonly children: ReactNode }) {
  return <span className="text-muted-foreground/60 font-normal italic">{children}</span>
}
