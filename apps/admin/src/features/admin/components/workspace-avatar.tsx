import { Avatar, AvatarFallback } from "@praximo/ui/components/avatar"
import { initials } from "@/features/admin/formatting.ts"
import { cn } from "@praximo/ui"

/**
 * Workspace identity mark: a branded initials gradient, everywhere and always.
 * It deliberately never shows the coach bot's Telegram photo — that photo is
 * the coach's property and they may change it at any time (#108), so a copy
 * rendered here would sooner or later misreport who they are.
 *
 * Size is set by the caller via className (`size-11` in list rows, `size-24`
 * in page headers).
 *
 * The ink is stated here even though `bg-primary text-primary-foreground` already carries it. That
 * utility hides `text-white` behind `@apply`, so tailwind-merge cannot see a
 * colour in it and leaves the fallback's own `text-muted-foreground` standing —
 * which then wins in the cascade and prints the initials grey on the violet
 * disc. Naming the colour is what lets the merge drop the one underneath.
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
      <AvatarFallback
        className={cn(
          "bg-primary text-primary-foreground text-base leading-relaxed font-semibold text-white",
          fallbackClassName,
        )}
      >
        {initials(name) || "?"}
      </AvatarFallback>
    </Avatar>
  )
}
