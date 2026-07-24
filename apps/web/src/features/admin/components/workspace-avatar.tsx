import { Avatar, AvatarFallback } from "@/components/ui/avatar.tsx"
import { initials } from "@/features/admin/formatting.ts"
import { cn } from "@/lib/utils.ts"

/**
 * Workspace identity mark: a branded initials gradient, everywhere and always.
 * It deliberately never shows the coach bot's Telegram photo — that photo is
 * the coach's property and they may change it at any time (#108), so a copy
 * rendered here would sooner or later misreport who they are.
 *
 * Size is set by the caller via className (`size-11` in list rows, `size-24`
 * in page headers).
 */
export function WorkspaceAvatar({
  name,
  className,
  fallbackClassName,
}: {
  readonly name: string
  readonly className?: string
  readonly fallbackClassName?: string
}) {
  return (
    <Avatar className={cn("size-11", className)}>
      <AvatarFallback className={cn("admin-avatar text-sm font-semibold", fallbackClassName)}>
        {initials(name) || "?"}
      </AvatarFallback>
    </Avatar>
  )
}
