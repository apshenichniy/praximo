import { displayName } from "@/features/admin/formatting.ts"
import type { WorkspaceDetail } from "@/features/admin/workspace-detail.ts"
import type { DeleteWorkspaceTransportError } from "@/server/admin-workspaces.functions.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

export type DeletionProgress = AdminSurface.DeletionProgress

/**
 * Which confirmation a workspace's deletion is worth. The bot is the dividing
 * line: without one there is no coach in a chat, no practice data and nothing
 * to release, so the workspace is an invite and one sheet is the honest weight
 * for it. Everything with a bot goes through the two-sheet gate (#110).
 */
export const deletionGate = (workspace: WorkspaceDetail): "light" | "guarded" =>
  workspace.botStatus === "awaiting-setup" ? "light" : "guarded"

/**
 * What the first sheet promises, in the order the admin will care about it:
 * the bot they can name, the person who loses something, the data, and the
 * finality. Concrete consequences rather than a generic "are you sure" — the
 * whole point of sheet one is that it can be read and refused.
 */
export const deletionConsequences = (workspace: WorkspaceDetail): ReadonlyArray<string> => {
  const coach = workspace.name.length === 0 ? "The coach" : workspace.name
  return [
    workspace.botUsername === undefined
      ? "The connected bot will be released"
      : `Bot @${workspace.botUsername} will be released`,
    `${coach} loses access to Praximo`,
    "All clients, sessions, transcripts and artifacts will be purged",
    "This cannot be undone",
  ]
}

export const deletionTitle = (workspace: WorkspaceDetail): string =>
  `Delete “${displayName(workspace.name)}”?`

export interface DeletionHeadline {
  readonly title: string
  readonly description: string
}

/**
 * The single light confirm a bot-less workspace gets. Its title names what is
 * actually being thrown away: a workspace nobody was ever invited to has no
 * invite to revoke, and promising one would be the first inaccurate sentence in
 * a flow whose whole job is accuracy.
 */
export const lightConfirmCopy = (workspace: WorkspaceDetail): DeletionHeadline =>
  workspace.invite === undefined
    ? {
        title: "Delete this workspace?",
        description: "It has never been invited, so nothing but the workspace itself is removed.",
      }
    : {
        title: "Delete invite and workspace?",
        description:
          "The invite stops working and this workspace is removed. Nothing else exists yet.",
      }

/** The danger-zone card promises exactly as much as the gate behind it. */
export const deletionCardCopy = (workspace: WorkspaceDetail): DeletionHeadline =>
  deletionGate(workspace) === "light"
    ? {
        title: "Delete workspace",
        description:
          "Removes the invite and this workspace. No bot, no clients and no sessions exist yet.",
      }
    : {
        title: "Delete workspace permanently",
        description:
          "Releases the bot and deletes the workspace with its clients, sessions, transcripts, artifacts and uploads. This cannot be undone.",
      }

/** Why an attempt stopped, in words the admin can act on. */
export const deletionErrorMessage = (error: DeleteWorkspaceTransportError): string => {
  switch (error) {
    case "validation":
      return "The deletion request is invalid. Close this and start again."
    case "conflict":
      return "Another deletion of this workspace is already running. Try again in a moment."
    case "retryable":
      return "A step could not be completed. Nothing was lost — try again to finish the deletion."
    case "blocked":
      return "The connected bot could not be released. The workspace was kept; contact support before retrying."
    case "server":
      return "Deletion failed. The workspace was kept; try again."
  }
}

export type DeletionStageKey = "sessions" | "farewell" | "bot" | "purge"

/**
 * `warned` is a stage that finished without doing what it set out to do — an
 * undeliverable farewell is the case. The pipeline deliberately moves past it,
 * so it cannot be an error, but ticking it green would tell the admin a message
 * reached the coach when none did.
 */
export type DeletionStageState = "done" | "warned" | "running" | "pending"

export interface DeletionStage {
  readonly key: DeletionStageKey
  readonly label: string
  readonly state: DeletionStageState
}

/** A stage's outcome once it has landed: its own wording, and whether it is clean. */
interface StageOutcome {
  readonly label: string
  readonly warned?: true
}

interface StageCopy {
  readonly key: DeletionStageKey
  /** Absent while the stage is still pending — the outcome names itself. */
  readonly outcome: StageOutcome | undefined
  readonly pending: string
  readonly running: string
}

const pipelineOutcome = {
  pending: undefined,
  cancelled: { label: "Sessions cancelled" },
  "nothing-active": { label: "No active sessions" },
} as const satisfies Record<DeletionProgress["pipeline"], StageOutcome | undefined>

const farewellOutcome = {
  pending: undefined,
  sent: { label: "Farewell message sent" },
  "not-applicable": { label: "No coach to notify" },
  undeliverable: { label: "Farewell could not be delivered", warned: true },
} as const satisfies Record<DeletionProgress["farewell"], StageOutcome | undefined>

const botOutcome = {
  pending: undefined,
  released: { label: "Bot released" },
  "not-connected": { label: "No bot to release" },
  "already-released": { label: "Bot already released" },
} as const satisfies Record<DeletionProgress["botRelease"], StageOutcome | undefined>

/**
 * The server pipeline, shown honestly (#110). Each stage reads its own settled
 * outcome — "No active sessions" is a different fact from "Sessions cancelled"
 * and the sheet says which one happened.
 *
 * Only one stage can be running, and only while the pipeline is actually being
 * driven: it never advances on its own, so a receipt nobody is working on has a
 * first *pending* stage rather than a spinning one.
 *
 * An absent receipt is the first moment of an attempt this screen just started
 * — the request is in flight and the first read has not landed yet. Nothing has
 * happened server-side that we know of, so every stage is pending, and the list
 * shows the first one spinning instead of leaving the sheet blank.
 */
export const deletionStages = (
  progress: DeletionProgress | undefined,
  running: boolean,
): ReadonlyArray<DeletionStage> => {
  const copies: ReadonlyArray<StageCopy> = [
    {
      key: "sessions",
      outcome: progress === undefined ? undefined : pipelineOutcome[progress.pipeline],
      pending: "Cancel active sessions",
      running: "Cancelling sessions…",
    },
    {
      key: "farewell",
      outcome: progress === undefined ? undefined : farewellOutcome[progress.farewell],
      pending: "Send the farewell message",
      running: "Sending the farewell…",
    },
    {
      key: "bot",
      outcome: progress === undefined ? undefined : botOutcome[progress.botRelease],
      pending: "Release the bot",
      running: "Releasing the bot…",
    },
    {
      key: "purge",
      // The cascade and the receipt are completed in one statement, so the
      // operation reaching `completed` is exactly "the data is gone".
      outcome: progress?.state === "completed" ? { label: "Workspace data purged" } : undefined,
      pending: "Purge workspace data",
      running: "Purging workspace data…",
    },
  ]

  const first = copies.findIndex((copy) => copy.outcome === undefined)
  return copies.map((copy, index) => {
    const outcome = copy.outcome
    if (outcome !== undefined) {
      return {
        key: copy.key,
        label: outcome.label,
        state: outcome.warned === true ? "warned" : "done",
      }
    }
    const isRunning = running && index === first
    return {
      key: copy.key,
      label: isRunning ? copy.running : copy.pending,
      state: isRunning ? "running" : "pending",
    }
  })
}

/**
 * Whether the pipeline is being driven right now. Two things can say so: this
 * screen's own request — true from the moment it is sent, before any receipt
 * has come back — and the server's driver lease, which covers an attempt
 * started somewhere else, or one still in flight on a screen just reopened.
 *
 * Both halves matter. Without the first, the gap between committing to the
 * deletion and reading the first receipt looks idle, and the button that was
 * just pressed sits there as though nothing happened. Without the second, a
 * deletion somebody else is driving would be called "paused" and invite a
 * concurrent attempt.
 */
export const deletionAdvancing = (
  progress: DeletionProgress | undefined,
  ownAttemptRunning: boolean,
): boolean => ownAttemptRunning || deletionAdvancingLapsesInMs(progress) > 0

/**
 * How long the receipt alone will keep vouching that the pipeline is moving —
 * `0` once nobody holds the lease. A caller that renders `deletionAdvancing`
 * needs this: the verdict changes with time rather than with any new data, so
 * nothing will prompt a redraw at the moment it flips unless something is
 * scheduled for exactly then.
 */
export const deletionAdvancingLapsesInMs = (progress: DeletionProgress | undefined): number =>
  progress === undefined || progress.state === "completed" ? 0 : progress.drivingLapsesInMs

/**
 * What the progress surface says about itself. The paused wording is the one
 * that matters: an interrupted deletion is not a failure and not a decision to
 * revisit — the workspace is already condemned, and the only thing left is to
 * finish it.
 *
 * `undefined` is the moment before the first receipt has been read back, which
 * is a deletion starting rather than an absent one.
 */
export const deletionHeadline = (
  progress: DeletionProgress | undefined,
  advancing: boolean,
): DeletionHeadline => {
  if (progress?.state === "completed") {
    return { title: "Workspace deleted", description: "Everything owned by it is gone." }
  }
  if (progress === undefined || advancing) {
    return {
      title: "Deleting workspace…",
      description: "You can close this — deletion continues in the background.",
    }
  }
  return {
    title: "Deletion paused",
    description: "This workspace is already being deleted. Resume to finish it.",
  }
}
