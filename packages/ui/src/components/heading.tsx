import type { ElementType, HTMLAttributes } from "react"

import { typographyRecipe, type InterfaceTypographyRole } from "../lib/typography.ts"
import { cn } from "../lib/utils.ts"

type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6"

export type HeadingProps = HTMLAttributes<HTMLElement> & {
  readonly as?: HeadingLevel
  readonly role?: Extract<
    InterfaceTypographyRole,
    "display" | "page-title" | "section-title" | "card-title"
  >
}

export function Heading({ as = "h2", className, role = "section-title", ...props }: HeadingProps) {
  const Component: ElementType = as

  return <Component className={cn(typographyRecipe({ role }), className)} {...props} />
}
