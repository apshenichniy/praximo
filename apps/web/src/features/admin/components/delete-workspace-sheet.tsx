import { useEffect, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert.tsx"
import { Button } from "@/components/ui/button.tsx"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { DeletionStageList } from "@/features/admin/components/deletion-stages.tsx"
import { notifyHaptic } from "@/features/admin/haptics.ts"
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
// The one filled destructive surface in the admin app. The theme's destructive
// is a light red, so the label goes dark on it — the same dark-on-light shape
// the primary button already has, and the only combination that carries
// readable contrast at this size.
const filledDestructive = "bg-destructive text-background hover:bg-destructive/90"

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
  running,
  error,
  onOpenChange,
  onConfirm,
}: {
  readonly workspace: WorkspaceDetail
  readonly open: boolean
  /** The server's own account of the pipeline, once an attempt has started. */
  readonly progress: DeletionProgress | undefined
  readonly running: boolean
  readonly error: string | undefined
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirm: () => void
}) {
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
            running={running}
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
          <ProgressStep progress={progress} running={running} error={error} onRetry={onConfirm} />
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
      <DrawerTitle className="text-lg font-semibold">{title}</DrawerTitle>
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
          <li key={consequence} className="flex gap-2.5 text-sm leading-5">
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
          className="h-13 w-full text-base font-semibold"
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
  const remaining = useArmingCountdown(ArmingSeconds)

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
          className={`h-13 w-full text-base font-semibold ${filledDestructive}`}
          onClick={onConfirm}
        >
          {remaining > 0 ? `Yes, delete everything (${remaining})` : "Yes, delete everything"}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          className="h-13 w-full text-base font-semibold"
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
function useArmingCountdown(seconds: number): number {
  const [remaining, setRemaining] = useState(seconds)

  useEffect(() => {
    if (remaining <= 0) return
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1_000)
    return () => clearTimeout(timer)
  }, [remaining])

  return remaining
}

function ProgressStep({
  progress,
  running,
  error,
  onRetry,
}: {
  readonly progress: DeletionProgress | undefined
  readonly running: boolean
  readonly error: string | undefined
  readonly onRetry: () => void
}) {
  // Until the first receipt arrives there is nothing the server has confirmed,
  // so the sheet says it is starting rather than inventing stage outcomes.
  if (progress === undefined) {
    return (
      <>
        <SheetHeader
          title="Deleting workspace…"
          description="You can close this — deletion continues in the background."
        />
        <div className="text-muted-foreground mt-6 flex items-center gap-3 text-sm">
          <Spinner className="text-primary size-[18px]" /> Starting the deletion…
        </div>
        <DeletionError error={error} onRetry={onRetry} />
      </>
    )
  }

  const headline = deletionHeadline(progress, running)
  return (
    <>
      <SheetHeader title={headline.title} description={headline.description} />
      <DeletionStageList stages={deletionStages(progress, running)} className="mt-6" />
      <DeletionError error={error} onRetry={onRetry} />
    </>
  )
}

function DeletionError({
  error,
  onRetry,
}: {
  readonly error: string | undefined
  readonly onRetry: () => void
}) {
  if (error === undefined) return null
  return (
    <div className="mt-6 flex flex-col gap-3">
      <Alert variant="destructive" className="bg-destructive/10 border-transparent">
        <AlertDescription className="text-destructive">{error}</AlertDescription>
      </Alert>
      <Button
        size="lg"
        className={`h-13 w-full text-base font-semibold ${filledDestructive}`}
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  )
}

function LightConfirm({
  workspace,
  running,
  error,
  onCancel,
  onConfirm,
}: {
  readonly workspace: WorkspaceDetail
  readonly running: boolean
  readonly error: string | undefined
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  return (
    <>
      <SheetHeader {...lightConfirmCopy(workspace)} />
      {error === undefined ? null : (
        <Alert variant="destructive" className="bg-destructive/10 mt-5 border-transparent">
          <AlertDescription className="text-destructive">{error}</AlertDescription>
        </Alert>
      )}
      <div className="mt-7 flex flex-col gap-2">
        <Button
          size="lg"
          disabled={running}
          aria-busy={running || undefined}
          className={`h-13 w-full text-base font-semibold ${filledDestructive}`}
          onClick={onConfirm}
        >
          {running ? (
            <>
              <Spinner /> Deleting…
            </>
          ) : error === undefined ? (
            "Delete workspace"
          ) : (
            "Try again"
          )}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          disabled={running}
          className="h-13 w-full text-base font-semibold"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </>
  )
}
