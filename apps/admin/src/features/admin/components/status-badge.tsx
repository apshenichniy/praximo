import { Badge } from "@praximo/ui/components/badge"
import { statusLabel, type BotStatus } from "@/features/admin/formatting.ts"
import { cn } from "@praximo/ui"

const statusTone = {
  "awaiting-setup": {
    badge: "bg-warning/12 text-warning ring-warning/20",
    dot: "bg-warning",
  },
  connected: {
    badge: "bg-success/12 text-success ring-success/20",
    dot: "bg-success",
  },
  "needs-relink": {
    badge: "bg-destructive/12 text-destructive ring-destructive/20",
    dot: "bg-destructive",
  },
} as const satisfies Record<BotStatus, { badge: string; dot: string }>

export function StatusBadge({ status }: { readonly status: BotStatus }) {
  const tone = statusTone[status]
  return (
    <Badge className={cn("border-transparent ring-1", tone.badge)}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
      {statusLabel[status]}
    </Badge>
  )
}
