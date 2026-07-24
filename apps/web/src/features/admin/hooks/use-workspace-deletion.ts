import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"

import { setAdminNotice } from "@/features/admin/admin-notice.ts"
import { notifyHaptic } from "@/features/admin/haptics.ts"
import {
  type DeletionProgress,
  deletionAdvancing,
  deletionAdvancingLapsesInMs,
  deletionErrorMessage,
} from "@/features/admin/workspace-deletion.ts"
import {
  adminWorkspaceDeletionQuery,
  deleteWorkspaceMutation,
} from "@/features/admin/workspace-queries.ts"

export interface WorkspaceDeletion {
  /** The server's receipt: absent for a workspace nobody has tried to delete. */
  readonly progress: DeletionProgress | undefined
  /** The pipeline is being driven — by this screen, or by an attempt elsewhere. */
  readonly advancing: boolean
  readonly error: string | undefined
  readonly start: () => void
}

/**
 * The deletion pipeline, driven from one place (#110). The request is minted
 * once per workspace and reused for every attempt, so an interrupted deletion
 * resumes the same operation rather than opening a second one; the server
 * adopts an operation started by an earlier session in the same way (#109).
 *
 * Progress is read from the server's own receipt rather than guessed from the
 * request's lifetime, and polled while the pipeline looks like it is moving —
 * either because this screen is driving it or because a stage landed moments
 * ago. A receipt that has stopped advancing is paused, not slow, and polling it
 * would be waiting for something nobody is doing.
 */
export function useWorkspaceDeletion(initData: string, workspaceId: string): WorkspaceDeletion {
  const queryClient = useQueryClient()
  const router = useRouter()
  const remove = useMutation(deleteWorkspaceMutation(initData, queryClient))
  const requestId = useRef<string | undefined>(undefined)
  const [error, setError] = useState<string>()

  // The query decides its own cadence from the receipt; this screen only adds
  // the one thing the receipt cannot know — that a request of ours is open.
  const { data: receipt } = useSuspenseQuery(
    adminWorkspaceDeletionQuery(initData, workspaceId, { watch: remove.isPending }),
  )

  const progress = receipt ?? undefined

  // A pipeline nobody is driving produces no new data — the polls keep
  // returning the same receipt, which the query cache rightly treats as nothing
  // to report. So the moment the lease lapses is scheduled explicitly; without
  // it the panel would claim to be deleting until something else happened to
  // redraw it.
  const [, markLapsed] = useState(0)
  const lapsesIn = deletionAdvancingLapsesInMs(progress)
  useEffect(() => {
    if (remove.isPending || lapsesIn <= 0) return
    const timer = setTimeout(() => markLapsed((tick) => tick + 1), lapsesIn)
    return () => clearTimeout(timer)
  }, [lapsesIn, remove.isPending])

  const start = async () => {
    requestId.current ??= crypto.randomUUID()
    setError(undefined)
    const result = await remove
      .mutateAsync({ workspaceId, requestId: requestId.current })
      .catch(() => undefined)

    if (result === undefined) {
      setError("Deletion failed. Check your connection and try again.")
      notifyHaptic("error")
      return
    }
    if (!result.ok) {
      setError(deletionErrorMessage(result.error))
      notifyHaptic("error")
      return
    }

    notifyHaptic("success")
    setAdminNotice(
      result.value.status === "deleted-farewell-undeliverable"
        ? "Workspace deleted. The coach farewell could not be delivered."
        : "Workspace deleted",
    )
    await router.navigate({ to: "/admin" })
  }

  return {
    progress,
    // Our own request counts from the moment it is sent — the first receipt is
    // a round trip away, and until it lands nothing else would say that the
    // deletion this screen just committed to is under way.
    advancing: deletionAdvancing(progress, remove.isPending),
    error,
    start: () => void start(),
  }
}
