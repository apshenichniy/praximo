import { CheckmarkCircle02Icon } from "@hugeicons-pro/core-stroke-rounded"
import { HugeiconsIcon } from "@hugeicons/react"

import { Spinner } from "@/components/ui/spinner.tsx"
import type { DeletionStage } from "@/features/admin/workspace-deletion.ts"
import { cn } from "@/lib/utils.ts"

/**
 * The pipeline as a list of stages, used both inside the progress sheet and on
 * the resume panel so an interrupted deletion is described in exactly the same
 * words as a running one. Each stage carries its own marker: a settled stage is
 * ticked, the stage being attempted spins, and everything still ahead is a
 * hollow ring — the shape alone separates past from future, so the list still
 * reads with colour ignored.
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
            {stage.state === "done" ? (
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                size={20}
                strokeWidth={2}
                className="text-emerald-300"
              />
            ) : stage.state === "running" ? (
              <Spinner className="text-primary size-[18px]" />
            ) : (
              <span
                aria-hidden="true"
                className="border-muted-foreground/40 size-[13px] rounded-full border-[1.5px]"
              />
            )}
          </span>
          <span
            className={cn(
              "text-sm",
              stage.state === "pending" ? "text-muted-foreground" : "font-medium",
            )}
          >
            {stage.label}
          </span>
        </li>
      ))}
    </ol>
  )
}
