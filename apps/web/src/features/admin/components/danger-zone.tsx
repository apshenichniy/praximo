import type { ReactNode } from "react"

import { Button } from "@/components/ui/button.tsx"
import { Card, CardContent } from "@/components/ui/card.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { Section, SectionTitle } from "@/features/admin/components/section.tsx"
import type { DeletionHeadline } from "@/features/admin/workspace-deletion.ts"

/** The one place on the details screen where an action cannot be taken back. */
export function DangerZone({ children }: { readonly children: ReactNode }) {
  return (
    <Section aria-labelledby="danger-zone-heading">
      <SectionTitle id="danger-zone-heading" className="text-destructive">
        Danger zone
      </SectionTitle>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </Section>
  )
}

function DangerCard({
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
        <p className="text-base font-semibold">{title}</p>
        <p className="text-muted-foreground mt-2 text-sm leading-5">{description}</p>
        {action}
      </CardContent>
    </Card>
  )
}

/**
 * Reset in one confirmed gesture (#107): the old code is cancelled and a fresh
 * one is minted together, so a workspace is never left without a live invite.
 * This card is the *destructive* half — resetting a live or accepted invite
 * costs the coach the link they already hold. Reissuing an invite that is
 * already dead is recovery and lives on the invite card instead.
 */
export function ResetInviteCard({
  copy,
  pending,
  onOpen,
}: {
  readonly copy: { readonly label: string; readonly description: string }
  readonly pending: boolean
  readonly onOpen: () => void
}) {
  return (
    <DangerCard
      title={copy.label}
      description={copy.description}
      action={
        <Button
          variant="destructive"
          size="lg"
          disabled={pending}
          aria-busy={pending || undefined}
          className="mt-5 font-semibold"
          onClick={onOpen}
        >
          {pending ? (
            <>
              <Spinner /> Issuing…
            </>
          ) : (
            copy.label
          )}
        </Button>
      }
    />
  )
}

/**
 * The entry to the deletion gate (#110). The card carries no confirmation of
 * its own — the sheet it opens is the whole safety mechanism — so its only job
 * is to say plainly what is behind the button before it is pressed.
 */
export function DeleteWorkspaceCard({
  copy,
  onOpen,
}: {
  readonly copy: DeletionHeadline
  readonly onOpen: () => void
}) {
  return (
    <DangerCard
      title={copy.title}
      description={copy.description}
      action={
        <Button variant="destructive" size="lg" className="mt-5 font-semibold" onClick={onOpen}>
          Delete workspace
        </Button>
      }
    />
  )
}
