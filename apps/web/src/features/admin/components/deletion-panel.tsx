import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button.tsx"
import { Card, CardContent } from "@/components/ui/card.tsx"
import {
  DeletionActionButton,
  DeletionError,
  DeletionStageList,
} from "@/features/admin/components/deletion-progress.tsx"
import { Section } from "@/features/admin/components/section.tsx"
import {
  type DeletionProgress,
  deletionHeadline,
  deletionStages,
} from "@/features/admin/workspace-deletion.ts"

/**
 * What the details screen becomes once a deletion is under way (#110). It
 * replaces the ordinary sections rather than sitting above them: a workspace
 * mid-purge has no settings worth editing, and offering them would invite work
 * that is about to be thrown away.
 *
 * It is also where an interrupted deletion is picked up. Nothing is offered
 * except finishing — the confirmation already happened, the bot may already be
 * released, and the only wrong outcome now is a workspace left half-deleted.
 * Resume appears only when the pipeline has actually stopped: while stages are
 * still landing, a second button would only start a second attempt.
 */
export function WorkspaceDeletionPanel({
  progress,
  advancing,
  error,
  onResume,
}: {
  readonly progress: DeletionProgress
  readonly advancing: boolean
  readonly error: string | undefined
  readonly onResume: () => void
}) {
  const headline = deletionHeadline(progress, advancing)

  return (
    <Section aria-labelledby="deletion-heading">
      <Card size="sm" className="border-destructive/40 bg-destructive/5 border shadow-none">
        <CardContent>
          <h2 id="deletion-heading" className="text-base font-semibold">
            {headline.title}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-5">{headline.description}</p>

          <DeletionStageList stages={deletionStages(progress, advancing)} className="mt-5" />

          {error === undefined ? null : (
            <div className="mt-5">
              <DeletionError error={error} />
            </div>
          )}

          {progress.state === "completed" ? (
            // Reached by watching an attempt started elsewhere finish. The
            // workspace no longer exists, so the only honest offer is the list.
            <Button
              variant="secondary"
              size="lg"
              className="mt-5 w-full font-semibold"
              render={<Link to="/admin" />}
            >
              Back to coaches
            </Button>
          ) : advancing && error === undefined ? null : (
            <DeletionActionButton
              label="Resume deletion"
              running={false}
              retry={error !== undefined}
              className="mt-5"
              onClick={onResume}
            />
          )}
        </CardContent>
      </Card>
    </Section>
  )
}
