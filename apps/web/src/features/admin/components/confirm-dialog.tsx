import type { ReactNode } from "react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx"
import { Button } from "@/components/ui/button.tsx"

/**
 * In-app replacement for `window.confirm`: Telegram webviews render native
 * confirms poorly (or suppress them entirely), so every destructive or
 * lossy action confirms through this dialog instead.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  onConfirm,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly confirmLabel: ReactNode
  readonly confirmVariant?: "default" | "destructive"
  readonly onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description === undefined ? null : (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
