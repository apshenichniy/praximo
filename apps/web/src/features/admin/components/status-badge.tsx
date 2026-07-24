import { Badge } from "@/components/ui/badge.tsx"
import { statusLabel, type BotStatus } from "@/features/admin/formatting.ts"
import { cn } from "@/lib/utils.ts"

const statusTone = {
  "awaiting-setup": {
    badge: "bg-amber-400/12 text-amber-300 ring-amber-400/20",
    dot: "bg-amber-300",
  },
  connected: {
    badge: "bg-emerald-400/12 text-emerald-300 ring-emerald-400/20",
    dot: "bg-emerald-300",
  },
  "needs-relink": {
    badge: "bg-rose-400/12 text-rose-300 ring-rose-400/20",
    dot: "bg-rose-300",
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
