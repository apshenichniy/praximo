import type { ComponentProps } from "react"

import { Heading } from "./heading.tsx"
import { cn } from "../lib/utils.ts"

export function Section({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("mt-12", className)} {...props} />
}

export function SectionTitle({
  className,
  ...props
}: Omit<ComponentProps<typeof Heading>, "as" | "role">) {
  return <Heading as="h2" role="section-title" className={cn("px-1", className)} {...props} />
}
