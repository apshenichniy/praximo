import type { ReactNode } from "react"

import { Card, CardContent } from "@praximo/ui/components/card"
import { Section, SectionTitle } from "@praximo/ui"

/** The one place on a details screen where an action cannot be taken back. */
export function DangerZone({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <Section aria-labelledby="danger-zone-heading">
      <SectionTitle id="danger-zone-heading" className="text-destructive">
        {title}
      </SectionTitle>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </Section>
  )
}

/**
 * One irreversible action, stated plainly before its button. The card carries no
 * confirmation of its own — whatever gate the action needs is the caller's, and
 * lives in the sheet or dialog the button opens.
 */
export function DangerCard({
  title,
  description,
  action,
}: {
  readonly title: string
  readonly description: ReactNode
  readonly action: ReactNode
}) {
  return (
    <Card size="sm" className="border-destructive/40 bg-destructive/5 border shadow-none">
      <CardContent>
        <p className="text-base leading-snug font-semibold">{title}</p>
        <p className="text-muted-foreground mt-2 text-base leading-relaxed leading-5">
          {description}
        </p>
        {action}
      </CardContent>
    </Card>
  )
}
