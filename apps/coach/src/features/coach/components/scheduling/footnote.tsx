import type { SessionKind } from "@praximo/domain"
import { clock } from "@/features/coach/clock.ts"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"

export function SchedulingFootnote({
  copy,
  clientName,
  offsetLabel,
  startMinutes,
  kind,
}: {
  readonly copy: ClientsCopy
  readonly clientName: string
  readonly offsetLabel: string
  readonly startMinutes: number | undefined
  readonly kind: SessionKind
}) {
  return (
    <p className="border-border text-muted-foreground mt-5 border-t pt-3 text-xs leading-normal leading-5">
      {startMinutes === undefined ? (
        <>
          {clientName}
          {copy.footnotePendingTail}
          <span className="text-foreground font-semibold">{offsetLabel}</span>.
        </>
      ) : (
        <>
          {clientName}
          {copy.footnoteReadyTail}
          <span className="text-foreground font-semibold tabular-nums">{clock(startMinutes)}</span>
          {" ("}
          <span className="text-foreground font-semibold">{offsetLabel}</span>
          {")."}
        </>
      )}
      {/* Restated here because the switch has scrolled away before submission. */}
      {kind === "intake" ? <> {copy.footnoteFirstSession}</> : null}
    </p>
  )
}
