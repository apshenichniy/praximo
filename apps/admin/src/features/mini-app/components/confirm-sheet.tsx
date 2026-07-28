import type { ReactNode } from "react"

import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@praximo/ui/components/drawer"
import { useOpenHaptic } from "@/presentation-host"

/** Matches the deletion sheet's, so two danger zones do not sit differently. */
const sheetPadding = "px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"

/**
 * In-app replacement for `window.confirm`: Telegram webviews render native
 * confirms poorly, or suppress them entirely, so every destructive or lossy
 * action confirms through this instead.
 *
 * It is a **bottom sheet**, not a centred dialog (#197). A phone's thumb rests
 * at the bottom of the screen, which is where the deletion sheet already put the
 * decision — and a danger zone that answers in two different shapes depending on
 * which danger it is teaches the coach nothing about either.
 *
 * A destructive confirmation spends its buttons the way that sheet does: Cancel
 * is the big comfortable target and the destructive action is quiet text under
 * it, so the easy press is the safe one. A merely *lossy* action — one that can
 * be done again — keeps the ordinary arrangement, its own action on top.
 *
 * What it deliberately does not borrow is the arming step. Three seconds of
 * countdown belongs to deleting a workspace, where a bot is released and a
 * practice is erased; charging the same toll for re-issuing an invite would
 * teach the coach to sit through it.
 */
export function ConfirmSheet({
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
  useOpenHaptic(open)
  const destructive = confirmVariant === "destructive"

  const cancel = (
    <Button
      variant="secondary"
      size="lg"
      className="h-13 w-full text-base leading-snug font-semibold"
      onClick={() => onOpenChange(false)}
    >
      Cancel
    </Button>
  )

  const confirm = destructive ? (
    <Button
      variant="ghost"
      size="lg"
      className="text-destructive hover:text-destructive hover:bg-destructive/10 h-12 w-full font-semibold"
      onClick={onConfirm}
    >
      {confirmLabel}
    </Button>
  ) : (
    <Button
      size="lg"
      className="h-13 w-full text-base leading-snug font-semibold"
      onClick={onConfirm}
    >
      {confirmLabel}
    </Button>
  )

  return (
    <Drawer open={open} showSwipeHandle onOpenChange={onOpenChange}>
      <DrawerContent className={sheetPadding}>
        <DrawerHeader className="p-0 pt-2 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <DrawerTitle>{title}</DrawerTitle>
          {description === undefined ? null : <DrawerDescription>{description}</DrawerDescription>}
        </DrawerHeader>
        <div className="mt-7 flex flex-col gap-1">
          {destructive ? cancel : confirm}
          {destructive ? confirm : cancel}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
