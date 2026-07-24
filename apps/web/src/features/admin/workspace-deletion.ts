import { displayName } from "@/features/admin/formatting.ts"
import type { WorkspaceDetail } from "@/features/admin/workspace-detail.ts"
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

export interface DeletionCardCopy {
  readonly title: string
  readonly description: string
  readonly action: string
}

/** The danger-zone card promises exactly as much as the gate behind it. */
export const deletionCardCopy = (workspace: WorkspaceDetail): DeletionCardCopy =>
  deletionGate(workspace) === "light"
    ? {
        title: "Delete workspace",
        description:
          "Removes the invite and this workspace. No bot, no clients and no sessions exist yet.",
        action: "Delete workspace",
      }
    : {
        title: "Delete workspace permanently",
        description:
          "Releases the bot and deletes the workspace with its clients, sessions, transcripts, artifacts and uploads. This cannot be undone.",
        action: "Delete workspace",
      }

export type DeletionStageKey = "sessions" | "farewell" | "bot" | "purge"

export type DeletionStageState = "done" | "running" | "pending"

export interface DeletionStage {
  readonly key: DeletionStageKey
  readonly label: string
  readonly state: DeletionStageState
}

interface StageCopy {
  readonly key: DeletionStageKey
  /** Absent while the stage is still pending — the outcome names itself. */
  readonly settled: string | undefined
  readonly pending: string
  readonly running: string
}

const pipelineCopy = {
  pending: undefined,
  cancelled: "Sessions cancelled",
  "nothing-active": "No active sessions",
} as const satisfies Record<DeletionProgress["pipeline"], string | undefined>

const farewellCopy = {
  pending: undefined,
  sent: "Farewell message sent",
  "not-applicable": "No coach to notify",
  undeliverable: "Farewell could not be delivered",
} as const satisfies Record<DeletionProgress["farewell"], string | undefined>

const botCopy = {
  pending: undefined,
  released: "Bot released",
  "not-connected": "No bot to release",
  "already-released": "Bot already released",
} as const satisfies Record<DeletionProgress["botRelease"], string | undefined>

/**
 * The server pipeline, shown honestly (#110). Each stage reads its own settled
 * outcome — "No active sessions" is a different fact from "Sessions cancelled"
 * and the sheet says which one happened.
 *
 * Only one stage can be running, and only while an attempt is actually in
 * flight: the pipeline never advances on its own, so a receipt nobody is
 * driving has a first *pending* stage, not a spinning one. `running` is the
 * caller's own knowledge of its request, which is the only place that truth
 * exists — the receipt records what landed, never what is being attempted.
 */
export const deletionStages = (
  progress: DeletionProgress,
  running: boolean,
): ReadonlyArray<DeletionStage> => {
  const copies: ReadonlyArray<StageCopy> = [
    {
      key: "sessions",
      settled: pipelineCopy[progress.pipeline],
      pending: "Cancel active sessions",
      running: "Cancelling sessions…",
    },
    {
      key: "farewell",
      settled: farewellCopy[progress.farewell],
      pending: "Send the farewell message",
      running: "Sending the farewell…",
    },
    {
      key: "bot",
      settled: botCopy[progress.botRelease],
      pending: "Release the bot",
      running: "Releasing the bot…",
    },
    {
      key: "purge",
      // The cascade and the receipt are completed in one statement, so the
      // operation reaching `completed` is exactly "the data is gone".
      settled: progress.state === "completed" ? "Workspace data purged" : undefined,
      pending: "Purge workspace data",
      running: "Purging workspace data…",
    },
  ]

  const first = copies.findIndex((copy) => copy.settled === undefined)
  return copies.map((copy, index) => {
    if (copy.settled !== undefined) return { key: copy.key, label: copy.settled, state: "done" }
    const isRunning = running && index === first
    return {
      key: copy.key,
      label: isRunning ? copy.running : copy.pending,
      state: isRunning ? "running" : "pending",
    }
  })
}

export interface DeletionHeadline {
  readonly title: string
  readonly description: string
}

/**
 * What the progress surface says about itself. The paused wording is the one
 * that matters: an interrupted deletion is not a failure and not a decision to
 * revisit — the workspace is already condemned, and the only thing left is to
 * finish it.
 */
export const deletionHeadline = (
  progress: DeletionProgress,
  running: boolean,
): DeletionHeadline => {
  if (progress.state === "completed") {
    return { title: "Workspace deleted", description: "Everything owned by it is gone." }
  }
  if (running) {
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
