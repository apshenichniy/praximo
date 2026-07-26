import { Button } from "@/components/ui/button.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import type { DeletionHeadline } from "@/features/admin/workspace-deletion.ts"
import { DangerCard } from "@/features/mini-app/components/danger-zone.tsx"

/**
 * The admin surface's two irreversible actions.
 *
 * `DangerZone` and `DangerCard` themselves are Mini App primitives (#167) — the
 * section and the card are layout, and the coach surface is about to grow a
 * danger zone of its own. What stays here is the pair of cards that carry admin
 * copy and admin types.
 */

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
