import { Alert02Icon, CheckmarkCircle02Icon } from "@hugeicons-pro/core-stroke-rounded"
import { HugeiconsIcon } from "@hugeicons/react"

import { Alert, AlertDescription } from "@/components/ui/alert.tsx"
import { Button } from "@/components/ui/button.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import type { DeletionStage } from "@/features/admin/workspace-deletion.ts"
import { cn } from "@/lib/utils.ts"

/**
 * The pipeline as a list of stages, used both inside the progress sheet and on
 * the resume panel so an interrupted deletion is described in exactly the same
 * words as a running one. Each stage carries its own marker: a settled stage is
 * ticked, one that finished without doing its job is flagged, the stage being
 * attempted spins, and everything still ahead is a hollow ring — the shape
 * alone separates past from future, so the list reads with colour ignored.
 */
export function DeletionStageList({
  stages,
  className,
}: {
  readonly stages: ReadonlyArray<DeletionStage>
  readonly className?: string
}) {
  return (
    <ol className={cn("flex flex-col gap-3.5", className)}>
      {stages.map((stage) => (
        <li key={stage.key} className="flex items-center gap-3">
          <span className="flex size-5 shrink-0 items-center justify-center">
            <StageMarker state={stage.state} />
          </span>
          <span
            className={cn(
              "text-body",
              stage.state === "pending"
                ? "text-muted-foreground"
                : stage.state === "warned"
                  ? "font-medium text-warning"
                  : "font-medium",
            )}
          >
            {stage.label}
          </span>
        </li>
      ))}
    </ol>
  )
}

function StageMarker({ state }: { readonly state: DeletionStage["state"] }) {
  switch (state) {
    case "done":
      return (
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          size={20}
          strokeWidth={2}
          className="text-success"
        />
      )
    case "warned":
      return <HugeiconsIcon icon={Alert02Icon} size={20} strokeWidth={2} className="text-warning" />
    case "running":
      return <Spinner className="text-primary size-[18px]" />
    case "pending":
      return (
        <span
          aria-hidden="true"
          className="border-muted-foreground/40 size-[13px] rounded-full border-[1.5px]"
        />
      )
  }
}

/**
 * The one filled destructive surface in the admin app, shared by every place
 * that commits to a deletion.
 *
 * The label is the page's own ground, which is what makes it work in both
 * schemes without a token of its own: the light scheme's destructive is a deep
 * red and `--background` is near-white on it (4.61:1), the dark scheme's is a
 * light red and `--background` is near-black on it (8.02:1). Stating white
 * outright would read correctly on one ground and fail on the other.
 */
export function DeletionActionButton({
  label,
  running,
  retry,
  className,
  onClick,
}: {
  readonly label: string
  readonly running: boolean
  /** An attempt already failed, so the same button is now a second try. */
  readonly retry: boolean
  readonly className?: string
  readonly onClick: () => void
}) {
  return (
    <Button
      size="lg"
      disabled={running}
      aria-busy={running || undefined}
      className={cn(
        "bg-destructive text-background hover:bg-destructive/90 h-13 w-full text-emphasis font-semibold",
        className,
      )}
      onClick={onClick}
    >
      {running ? (
        <>
          <Spinner /> Deleting…
        </>
      ) : retry ? (
        "Try again"
      ) : (
        label
      )}
    </Button>
  )
}

export function DeletionError({ error }: { readonly error: string | undefined }) {
  if (error === undefined) return null
  return (
    <Alert variant="destructive" className="bg-destructive/10 border-transparent">
      <AlertDescription className="text-destructive">{error}</AlertDescription>
    </Alert>
  )
}
