import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.tsx"
import { initials } from "@/features/admin/formatting.ts"
import { cn } from "@/lib/utils.ts"

/**
 * Workspace identity avatar: custom image when available, branded initials
 * gradient otherwise. Size is set by the caller via className (`size-11` in
 * list rows, `size-24` in page headers).
 */
export function WorkspaceAvatar({
  name,
  imageUrl,
  className,
  fallbackClassName,
}: {
  readonly name: string
  readonly imageUrl?: string | undefined
  readonly className?: string
  readonly fallbackClassName?: string
}) {
  return (
    <Avatar className={cn("size-11", className)}>
      {imageUrl === undefined ? null : <AvatarImage src={imageUrl} alt="Workspace avatar" />}
      <AvatarFallback className={cn("admin-avatar text-sm font-semibold", fallbackClassName)}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
