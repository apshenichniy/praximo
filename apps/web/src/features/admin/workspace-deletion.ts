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
 */
export const deletionStages = (
  progress: DeletionProgress,
  running: boolean,
): ReadonlyArray<DeletionStage> => {
  const copies: ReadonlyArray<StageCopy> = [
    {
      key: "sessions",
      outcome: pipelineOutcome[progress.pipeline],
      pending: "Cancel active sessions",
      running: "Cancelling sessions…",
    },
    {
      key: "farewell",
      outcome: farewellOutcome[progress.farewell],
      pending: "Send the farewell message",
      running: "Sending the farewell…",
    },
    {
      key: "bot",
      outcome: botOutcome[progress.botRelease],
      pending: "Release the bot",
      running: "Releasing the bot…",
    },
    {
      key: "purge",
      // The cascade and the receipt are completed in one statement, so the
      // operation reaching `completed` is exactly "the data is gone".
      outcome: progress.state === "completed" ? { label: "Workspace data purged" } : undefined,
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
 * How long after a stage lands the pipeline is still assumed to be moving.
 * Every stage is one RPC or Bot API round trip, so a gap this long means the
 * attempt driving it is gone rather than slow.
 */
const StillAdvancingMs = 20_000

/**
 * Whether the pipeline is being driven right now. Two things can say so: this
 * screen's own request, and — for an attempt started somewhere else, or on a
 * screen reopened while one is still in flight — a stage having landed moments
 * ago. Without the second, a deletion that is visibly progressing would be
 * called "paused" and invite a second, concurrent attempt.
 *
 * The comparison is absolute, so a client clock that disagrees with the server
 * falls back to "not being driven" — which offers a Resume that is safe to
 * decline, rather than hiding one that is needed.
 */
export const deletionAdvancing = (
  progress: DeletionProgress,
  ownAttemptRunning: boolean,
  nowMs: number,
): boolean => ownAttemptRunning || deletionAdvancingLapsesInMs(progress, nowMs) > 0

/**
 * How long the receipt alone will keep vouching that the pipeline is moving —
 * `0` once it has stopped doing so. A caller that renders `deletionAdvancing`
 * needs this: the verdict changes with the clock rather than with any new data,
 * so nothing will prompt a redraw at the moment it flips unless something is
 * scheduled for exactly then.
 */
export const deletionAdvancingLapsesInMs = (progress: DeletionProgress, nowMs: number): number => {
  if (progress.state === "completed") return 0
  const since = Math.abs(nowMs - new Date(progress.advancedAt).getTime())
  return since >= StillAdvancingMs ? 0 : StillAdvancingMs - since
}

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
