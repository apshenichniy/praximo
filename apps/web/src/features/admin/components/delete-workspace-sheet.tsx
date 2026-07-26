import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button.tsx"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer.tsx"
import {
  DeletionActionButton,
  DeletionError,
  DeletionStageList,
} from "@/features/admin/components/deletion-progress.tsx"
import { notifyHaptic, useOpenHaptic } from "@/features/mini-app/haptics.ts"
import type { WorkspaceDetail } from "@/features/admin/workspace-detail.ts"
import {
  type DeletionProgress,
  deletionConsequences,
  deletionGate,
  deletionHeadline,
  deletionStages,
  deletionTitle,
  lightConfirmCopy,
} from "@/features/admin/workspace-deletion.ts"

/** The motor pause that replaces typing the workspace name (#110). */
const ArmingSeconds = 3

const sheetPadding = "px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"

type Phase = "consequences" | "arm" | "progress"

/**
 * Deletion, BotFather-style (#110). Typing a workspace name is a desktop
 * pattern; on a phone the safety has to come from the buttons themselves, so
 * this sheet spends two of them:
 *
 * 1. **Consequences.** Exactly what will happen, with Cancel as the big
 *    comfortable target and the destructive action as quiet text below it.
 * 2. **Arming.** The button order flips and both labels change, so muscle
 *    memory carried over from sheet one lands on "Keep workspace"; the
 *    destructive button arms only after a three-second countdown, which
 *    restarts every time this step is entered.
 * 3. **Progress.** The server pipeline, stage by stage, closable at any point
 *    — the deletion is already running and does not need this screen.
 *
 * A workspace with no bot never reaches the gate: there is nothing to release
 * and no practice data behind it, so it gets a single light confirm instead.
 */
export function DeleteWorkspaceSheet({
  workspace,
  open,
  progress,
  advancing,
  error,
  onOpenChange,
  onConfirm,
}: {
  readonly workspace: WorkspaceDetail
  readonly open: boolean
  /** The server's own account of the pipeline, once an attempt has started. */
  readonly progress: DeletionProgress | undefined
  readonly advancing: boolean
  readonly error: string | undefined
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirm: () => void
}) {
  useOpenHaptic(open)
  const gate = deletionGate(workspace)
  const [phase, setPhase] = useState<Phase>("consequences")
  // Bumped on every entry into the arming step so the countdown remounts —
  // reopening sheet two must never inherit a countdown that already elapsed.
  const [armToken, setArmToken] = useState(0)

  useEffect(() => {
    if (open) setPhase("consequences")
  }, [open])

  const arm = () => {
    setArmToken((token) => token + 1)
    setPhase("arm")
  }

  const confirm = () => {
    notifyHaptic("warning")
    setPhase("progress")
    onConfirm()
  }

  return (
    <Drawer open={open} showSwipeHandle onOpenChange={onOpenChange}>
      <DrawerContent className={sheetPadding}>
        {gate === "light" ? (
          <LightConfirm
            workspace={workspace}
            advancing={advancing}
            error={error}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : phase === "consequences" ? (
          <ConsequencesStep
            workspace={workspace}
            onCancel={() => onOpenChange(false)}
            onContinue={arm}
          />
        ) : phase === "arm" ? (
          <ArmingStep key={armToken} onKeep={() => onOpenChange(false)} onConfirm={confirm} />
        ) : (
          <ProgressStep
            progress={progress}
            advancing={advancing}
            error={error}
            onRetry={onConfirm}
          />
        )}
      </DrawerContent>
    </Drawer>
  )
}

function SheetHeader({
  title,
  description,
}: {
  readonly title: string
  readonly description?: string
}) {
  return (
    <DrawerHeader className="p-0 pt-2 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
      <DrawerTitle className="text-heading font-semibold">{title}</DrawerTitle>
      {description === undefined ? null : <DrawerDescription>{description}</DrawerDescription>}
    </DrawerHeader>
  )
}

function ConsequencesStep({
  workspace,
  onCancel,
  onContinue,
}: {
  readonly workspace: WorkspaceDetail
  readonly onCancel: () => void
  readonly onContinue: () => void
}) {
  return (
    <>
      <SheetHeader title={deletionTitle(workspace)} />
      <ul className="mt-4 flex flex-col gap-2.5">
        {deletionConsequences(workspace).map((consequence) => (
          <li key={consequence} className="flex gap-2.5 text-body leading-5">
            <span aria-hidden="true" className="text-destructive shrink-0">
              —
            </span>
            {consequence}
          </li>
        ))}
      </ul>
      <div className="mt-7 flex flex-col gap-1">
        <Button
          variant="secondary"
          size="lg"
          className="h-13 w-full text-emphasis font-semibold"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 h-12 w-full font-semibold"
          onClick={onContinue}
        >
          Delete workspace
        </Button>
      </div>
    </>
  )
}

function ArmingStep({
  onKeep,
  onConfirm,
}: {
  readonly onKeep: () => void
  readonly onConfirm: () => void
}) {
  const remaining = useArmingCountdown()

  return (
    <>
      <SheetHeader
        title="Are you absolutely sure?"
        description="The workspace, its bot and all data will be gone for good."
      />
      <div className="mt-7 flex flex-col gap-2">
        <Button
          size="lg"
          disabled={remaining > 0}
          className="bg-destructive text-background hover:bg-destructive/90 h-13 w-full text-emphasis font-semibold"
          onClick={onConfirm}
        >
          {remaining > 0 ? `Yes, delete everything (${remaining})` : "Yes, delete everything"}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          className="h-13 w-full text-emphasis font-semibold"
          onClick={onKeep}
        >
          Keep workspace
        </Button>
      </div>
    </>
  )
}

/**
 * The countdown that arms the destructive button. It lives in state rather than
 * in a deadline read from the clock so that mounting *is* the reset: the step
 * is remounted every time it is entered, and there is no way to inherit an
 * elapsed countdown from a previous visit.
 */
function useArmingCountdown(): number {
  const [remaining, setRemaining] = useState(ArmingSeconds)

  useEffect(() => {
    if (remaining <= 0) return
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1_000)
    return () => clearTimeout(timer)
  }, [remaining])

  return remaining
}

function ProgressStep({
  progress,
  advancing,
  error,
  onRetry,
}: {
  readonly progress: DeletionProgress | undefined
  readonly advancing: boolean
  readonly error: string | undefined
  readonly onRetry: () => void
}) {
  const headline = deletionHeadline(progress, advancing)

  return (
    <>
      <SheetHeader {...headline} />
      {/* Rendered before the first receipt too: the attempt is already in
          flight, and a blank sheet is the one moment this flow would stop
          accounting for itself. */}
      <DeletionStageList stages={deletionStages(progress, advancing)} className="mt-6" />
      {error === undefined ? null : (
        <div className="mt-6 flex flex-col gap-3">
          <DeletionError error={error} />
          <DeletionActionButton
            label="Resume deletion"
            running={advancing}
            retry
            onClick={onRetry}
          />
        </div>
      )}
    </>
  )
}

function LightConfirm({
  workspace,
  advancing,
  error,
  onCancel,
  onConfirm,
}: {
  readonly workspace: WorkspaceDetail
  readonly advancing: boolean
  readonly error: string | undefined
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  return (
    <>
      <SheetHeader {...lightConfirmCopy(workspace)} />
      {error === undefined ? null : (
        <div className="mt-5">
          <DeletionError error={error} />
        </div>
      )}
      <div className="mt-7 flex flex-col gap-2">
        <DeletionActionButton
          label="Delete workspace"
          running={advancing}
          retry={error !== undefined}
          onClick={onConfirm}
        />
        <Button
          variant="secondary"
          size="lg"
          disabled={advancing}
          className="h-13 w-full text-emphasis font-semibold"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </>
  )
}
