import type { ComponentProps } from "react"

import { cn } from "@/lib/utils.ts"

export function Section({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("mt-12", className)} {...props} />
}

export function SectionTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("px-1 text-2xl font-semibold tracking-tight", className)} {...props} />
}
