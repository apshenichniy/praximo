import { CameraAdd01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReactNode } from "react"

import { Skeleton } from "@/components/ui/skeleton.tsx"
import { cn } from "@/lib/utils.ts"

/**
 * Circular avatar picker used by the create and edit headers: the avatar
 * itself is the file-input trigger, with a camera badge overlay. Status
 * messages and undo/reset actions compose below it at the call site.
 */
export function AvatarEditor({
  imageUrl,
  fallback,
  loading = false,
  disabled,
  srLabel,
  onSelectFile,
}: {
  readonly imageUrl: string | undefined
  readonly fallback: ReactNode
  /** True while the stored custom avatar blob is still downloading. */
  readonly loading?: boolean
  readonly disabled: boolean
  readonly srLabel: string
  readonly onSelectFile: (file: File | undefined) => void
}) {
  return (
    <label className="group relative mx-auto block size-24 cursor-pointer">
      <span className="admin-avatar ring-border flex size-24 items-center justify-center overflow-hidden rounded-full text-2xl font-bold ring-1">
        {loading ? (
          <Skeleton className="size-full rounded-full" />
        ) : imageUrl === undefined ? (
          fallback
        ) : (
          <img
            src={imageUrl}
            alt="Workspace avatar"
            className={cn("size-full object-cover", "animate-in fade-in duration-300")}
          />
        )}
      </span>
      <span className="bg-primary text-primary-foreground ring-background absolute right-0 bottom-0 flex size-9 items-center justify-center rounded-full ring-4 transition-transform group-active:scale-95">
        <HugeiconsIcon icon={CameraAdd01Icon} size={19} strokeWidth={2} />
      </span>
      <span className="sr-only">{srLabel}</span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          onSelectFile(event.target.files?.[0])
          event.target.value = ""
        }}
      />
    </label>
  )
}

/** Status line under the avatar editor (processing, errors, load warnings). */
export function AvatarEditorMessage({
  tone,
  children,
}: {
  readonly tone: "muted" | "destructive" | "warning"
  readonly children: ReactNode
}) {
  return (
    <p
      className={cn(
        "mt-3 text-sm",
        tone === "muted" && "text-muted-foreground",
        tone === "destructive" && "text-destructive",
        tone === "warning" && "text-amber-200",
      )}
    >
      {children}
    </p>
  )
}
