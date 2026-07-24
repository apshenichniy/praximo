import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button.tsx"
import { WorkspaceAvatar } from "@/features/admin/components/workspace-avatar.tsx"
import { displayName } from "@/features/admin/formatting.ts"

/**
 * One header for both variants. The avatar is the branded initials mark rather
 * than the bot's Telegram photo: the coach owns that photo and may change it at
 * any time (#108), so showing a stale copy here would misreport their identity.
 *
 * "Open bot" appears only once there is a bot to open — an action that cannot
 * succeed is worse than an absent one on a screen whose job is honest status.
 */
export function WorkspaceDetailHeader({
  name,
  botUsername,
  subtitle,
  onOpenBot,
}: {
  readonly name: string
  readonly botUsername: string | undefined
  readonly subtitle: string
  readonly onOpenBot: (link: string) => void
}) {
  return (
    <header className="mt-7 flex flex-col items-center text-center">
      <WorkspaceAvatar
        name={name}
        className="ring-primary/25 shadow-primary/20 size-24 shadow-2xl ring-1"
        fallbackClassName="text-3xl"
      />
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-balance">
        {displayName(name)}
      </h1>
      {botUsername === undefined ? (
        <p className="text-muted-foreground mt-2 text-sm">{subtitle}</p>
      ) : (
        <>
          <p className="text-muted-foreground mt-2 text-sm">@{botUsername}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 rounded-full font-semibold"
            onClick={() => onOpenBot(`https://t.me/${botUsername}`)}
          >
            Open bot
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={2} />
          </Button>
        </>
      )}
    </header>
  )
}
