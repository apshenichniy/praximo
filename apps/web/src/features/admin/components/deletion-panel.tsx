import { Alert, AlertDescription } from "@/components/ui/alert.tsx"
import { Button } from "@/components/ui/button.tsx"
import { Card, CardContent } from "@/components/ui/card.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { DeletionStageList } from "@/features/admin/components/deletion-stages.tsx"
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
 */
export function WorkspaceDeletionPanel({
  progress,
  running,
  error,
  onResume,
}: {
  readonly progress: DeletionProgress
  readonly running: boolean
  readonly error: string | undefined
  readonly onResume: () => void
}) {
  const headline = deletionHeadline(progress, running)

  return (
    <Section aria-labelledby="deletion-heading">
      <Card size="sm" className="border-destructive/40 bg-destructive/5 border shadow-none">
        <CardContent>
          <h2 id="deletion-heading" className="text-base font-semibold">
            {headline.title}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-5">{headline.description}</p>

          <DeletionStageList stages={deletionStages(progress, running)} className="mt-5" />

          {error === undefined ? null : (
            <Alert variant="destructive" className="bg-destructive/10 mt-5 border-transparent">
              <AlertDescription className="text-destructive">{error}</AlertDescription>
            </Alert>
          )}

          <Button
            size="lg"
            disabled={running}
            aria-busy={running || undefined}
            className="bg-destructive text-background hover:bg-destructive/90 mt-5 w-full font-semibold"
            onClick={onResume}
          >
            {running ? (
              <>
                <Spinner /> Deleting…
              </>
            ) : error === undefined ? (
              "Resume deletion"
            ) : (
              "Try again"
            )}
          </Button>
        </CardContent>
      </Card>
    </Section>
  )
}
