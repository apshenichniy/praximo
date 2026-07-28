import type { ElementType, HTMLAttributes } from "react"

import { typographyRecipe, type InterfaceTypographyRole } from "../lib/typography.ts"
import { cn } from "../lib/utils.ts"

type TextElement = "p" | "span" | "div" | "label"

export type TextProps = HTMLAttributes<HTMLElement> & {
  readonly as?: TextElement
  readonly mono?: boolean
  readonly role?: Extract<InterfaceTypographyRole, "body" | "body-small" | "label" | "caption">
}

export function Text({ as = "p", className, mono = false, role = "body", ...props }: TextProps) {
  const Component: ElementType = as

  return <Component className={cn(typographyRecipe({ role, mono }), className)} {...props} />
}
