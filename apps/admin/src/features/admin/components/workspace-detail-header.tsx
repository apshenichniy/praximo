import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Heading, Text } from "@praximo/ui"
import { Button } from "@praximo/ui/components/button"
import { WorkspaceAvatar } from "@/features/admin/components/workspace-avatar.tsx"
import { displayName } from "@/features/admin/formatting.ts"
import { StatusBadge } from "@/features/mini-app/components/status-badge.tsx"
import { detailStatus, type WorkspaceDetail } from "@/features/admin/workspace-detail.ts"

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
        fallbackClassName="text-5xl leading-none"
      />
      <Heading as="h1" role="display" className="mt-6 text-balance">
        {displayName(workspace.name)}
      </Heading>
      {botUsername === undefined ? null : (
        <Text className="text-muted-foreground mt-1.5">@{botUsername}</Text>
      )}
      {/* The hero says the state as a badge; the rows of the list say it as a
          coloured word (#198). The icon stays — it is the same second channel
          the badge's dot is elsewhere, and here there is room for the better
          one. */}
      <StatusBadge
        tone={status.tone}
        dot={false}
        className="mt-3 gap-2 px-3 py-1.5 text-base leading-relaxed"
      >
        <HugeiconsIcon icon={status.icon} size={18} strokeWidth={2.2} />
        {status.label}
      </StatusBadge>
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
