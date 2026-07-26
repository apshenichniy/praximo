import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button.tsx"
import type { CoachStateTone } from "@/features/admin/coach-progress.ts"
import { WorkspaceAvatar } from "@/features/admin/components/workspace-avatar.tsx"
import { displayName } from "@/features/admin/formatting.ts"
import { detailStatus, type WorkspaceDetail } from "@/features/admin/workspace-detail.ts"
import { cn } from "@/lib/utils.ts"

const toneClass = {
  amber: "text-amber-300",
  sky: "text-sky-300",
  emerald: "text-emerald-300",
  rose: "text-rose-300",
  muted: "text-muted-foreground",
} as const satisfies Record<CoachStateTone, string>

/**
 * One header for both variants. The avatar is the branded initials mark rather
 * than the bot's Telegram photo: the coach owns that photo and may change it at
 * any time (#108), so showing a stale copy here would misreport their identity.
 *
 * The status is an icon beside a coloured word rather than a badge — the same
 * choice the coaches list makes (#107), so a coach reads the same on both
 * screens. It carries no border or fill of its own: at this size the weight and
 * the tone are already the loudest thing under the name, and a chip around them
 * would compete with the avatar for the eye.
 *
 * "Open bot" appears only once there is a bot to open — an action that cannot
 * succeed is worse than an absent one on a screen whose job is honest status.
 */
export function WorkspaceDetailHeader({
  workspace,
  onOpenBot,
}: {
  readonly workspace: WorkspaceDetail
  readonly onOpenBot: (link: string) => void
}) {
  const status = detailStatus(workspace)
  const botUsername = workspace.botUsername

  return (
    <header className="mt-7 flex flex-col items-center text-center">
      <WorkspaceAvatar
        name={workspace.name}
        className="ring-primary/25 shadow-primary/20 size-24 shadow-2xl ring-1"
        fallbackClassName="text-display"
      />
      <h1 className="mt-6 text-display font-semibold tracking-tight text-balance">
        {displayName(workspace.name)}
      </h1>
      {botUsername === undefined ? null : (
        <p className="text-muted-foreground mt-1.5 text-body">@{botUsername}</p>
      )}
      <p
        className={cn(
          "mt-3 flex items-center gap-2 text-emphasis font-bold tracking-tight",
          toneClass[status.tone],
        )}
      >
        <HugeiconsIcon icon={status.icon} size={20} strokeWidth={2.2} />
        {status.label}
      </p>
      {botUsername === undefined ? null : (
        <Button
          variant="outline"
          size="sm"
          className="mt-5 rounded-full font-semibold"
          onClick={() => onOpenBot(`https://t.me/${botUsername}`)}
        >
          Open bot
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={2} />
        </Button>
      )}
    </header>
  )
}
