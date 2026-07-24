import type { ReactNode } from "react"

import { Card } from "@/components/ui/card.tsx"
import { formatRelativeTime, formatTimestamp } from "@/features/admin/formatting.ts"
import { cn } from "@/lib/utils.ts"

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
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium">{children}</dd>
    </div>
  )
}

/**
 * A moment, read twice: the relative time answers "is this recent?" at a glance
 * and the absolute date underneath answers "when exactly?" without a tap.
 */
export function TimestampValue({
  value,
  empty,
}: {
  readonly value: string | undefined
  readonly empty: string
}) {
  if (value === undefined) return <span className="text-muted-foreground font-normal">{empty}</span>
  return (
    <span className="flex flex-col items-end">
      <span>{formatRelativeTime(value)}</span>
      <span className="text-muted-foreground text-xs font-normal">
        {formatTimestamp(value, "")}
      </span>
    </span>
  )
}

/** A value the surface deliberately does not have yet — never a zero (#113). */
export function PlaceholderValue({ children }: { readonly children: ReactNode }) {
  return <span className="text-muted-foreground/60 font-normal italic">{children}</span>
}
