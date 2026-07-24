import type { CreateInviteDelivery } from "@praximo/domain"
import type { QueryClient } from "@tanstack/react-query"
import { queryOptions } from "@tanstack/react-query"
import { deletionAdvancing } from "@/features/admin/workspace-deletion.ts"
import {
  createAdminCoachInvite,
  type CreateInviteTransportResult,
  deleteAdminWorkspaceRequest,
  type DeleteWorkspaceTransportResult,
  loadAdminWorkspace,
  loadAdminWorkspaceDeletion,
  loadAdminWorkspaces,
  prepareAdminCoachInviteShare,
  type PrepareShareTransportResult,
  recordAdminCoachInviteShare,
  reissueAdminWorkspaceInvite,
  renameAdminWorkspace,
  type RenameTransportResult,
} from "@/server/admin-workspaces.functions.ts"
import type { AdminSurface } from "@/server/admin-surface.ts"

export const workspaceKeys = {
  all: ["admin", "workspaces"] as const,
  list: () => [...workspaceKeys.all, "list"] as const,
  detail: (workspaceId: string) => [...workspaceKeys.all, "detail", workspaceId] as const,
  deletion: (workspaceId: string) => [...workspaceKeys.all, "deletion", workspaceId] as const,
}

export const adminWorkspaceListQuery = (initData: string) =>
  queryOptions({
    queryKey: workspaceKeys.list(),
    queryFn: () => loadAdminWorkspaces({ data: { initData } }),
    retry: false,
  })

export const adminWorkspaceDetailQuery = (initData: string, workspaceId: string) =>
  queryOptions({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: () => loadAdminWorkspace({ data: { initData, workspaceId } }),
    retry: false,
  })

/**
 * Fast enough that a stage settling reads as the sheet reacting to the server
 * rather than as a page refreshing, slow enough that a pipeline dominated by
 * two Telegram round-trips is not polled dozens of times per stage.
 */
const ActiveDeletionPollMs = 800

/**
 * A deletion nobody is driving can still change — another session may resume
 * it — so it is watched, just not at the pace of one that is moving. This is
 * also what re-renders the screen when the pipeline goes quiet, so a stalled
 * attempt starts reading as paused within a few seconds rather than looking
 * busy until the admin navigates away.
 */
const PausedDeletionPollMs = 4_000

/**
 * The deletion receipt for one workspace (#110). While no receipt exists there
 * is nothing to poll, so an ordinary workspace costs exactly one read; the
 * cadence past that follows what the receipt itself says is happening.
 */
export const adminWorkspaceDeletionQuery = (
  initData: string,
  workspaceId: string,
  options?: { readonly watch?: boolean },
) =>
  queryOptions({
    queryKey: workspaceKeys.deletion(workspaceId),
    queryFn: () => loadAdminWorkspaceDeletion({ data: { initData, workspaceId } }),
    retry: false,
    refetchInterval: (query) => {
      const receipt = query.state.data
      const watching = options?.watch === true
      if (receipt === null || receipt === undefined) return watching ? ActiveDeletionPollMs : false
      if (receipt.state === "completed") return false
      return deletionAdvancing(receipt, watching) ? ActiveDeletionPollMs : PausedDeletionPollMs
    },
  })

export interface CreateCoachInviteMutationInput {
  readonly input: {
    readonly requestId: string
    readonly name: string
  }
  readonly delivery: CreateInviteDelivery
}

export const createCoachInviteMutation = (initData: string, queryClient: QueryClient) => ({
  mutationFn: async ({
    input,
    delivery,
  }: CreateCoachInviteMutationInput): Promise<CreateInviteTransportResult> =>
    createAdminCoachInvite({ data: { initData, input, delivery } }),
  onSuccess: (result: CreateInviteTransportResult) => {
    if (!result.ok) return
    // The pending card is derived server-side from the whole aggregate, so the
    // list is refetched rather than patched with a half-shaped optimistic row.
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.list() })
  },
})

export const prepareCoachInviteShareMutation = (initData: string) => ({
  mutationFn: async ({
    inviteId,
    language,
  }: {
    readonly inviteId: string
    readonly language: CreateInviteDelivery["language"]
  }): Promise<PrepareShareTransportResult> =>
    prepareAdminCoachInviteShare({ data: { initData, inviteId, language } }),
})

export const recordCoachInviteShareMutation = (initData: string) => ({
  mutationFn: async ({
    inviteId,
    language,
  }: {
    readonly inviteId: string
    readonly language: CreateInviteDelivery["language"]
  }) => recordAdminCoachInviteShare({ data: { initData, inviteId, language } }),
})

export interface RenameWorkspaceMutationInput {
  readonly workspaceId: string
  readonly input: {
    readonly requestId: string
    readonly expectedUpdatedAt: string
    readonly name: string
  }
}

/**
 * The label rename (#108). The server answers with the whole detail projection
 * — including the new `updatedAt` the next rename is checked against — so the
 * cache is written from the response rather than patched optimistically.
 */
export const renameWorkspaceMutation = (initData: string, queryClient: QueryClient) => ({
  mutationFn: async ({
    workspaceId,
    input,
  }: RenameWorkspaceMutationInput): Promise<RenameTransportResult> =>
    renameAdminWorkspace({ data: { initData, workspaceId, input } }),
  onSuccess: (result: RenameTransportResult) => {
    if (!result.ok) return
    queryClient.setQueryData(workspaceKeys.detail(result.value.id), result.value)
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.list() })
  },
})

export const reissueWorkspaceInviteMutation = (initData: string, queryClient: QueryClient) => ({
  mutationFn: ({
    workspaceId,
    expectedInviteId,
    requestId,
  }: {
    readonly workspaceId: string
    readonly expectedInviteId: string
    readonly requestId: string
  }) =>
    reissueAdminWorkspaceInvite({
      data: { initData, workspaceId, expectedInviteId, requestId },
    }),
  onSuccess: (
    result: Awaited<ReturnType<typeof reissueAdminWorkspaceInvite>>,
    variables: { readonly workspaceId: string },
  ) => {
    if (!result.ok) return
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(variables.workspaceId) })
  },
})

export const deleteWorkspaceMutation = (initData: string, queryClient: QueryClient) => ({
  mutationFn: ({
    workspaceId,
    requestId,
  }: {
    readonly workspaceId: string
    readonly requestId: string
  }): Promise<DeleteWorkspaceTransportResult> =>
    deleteAdminWorkspaceRequest({ data: { initData, workspaceId, requestId } }),
  onSettled: (
    _result: DeleteWorkspaceTransportResult | undefined,
    _error: unknown,
    variables: { readonly workspaceId: string },
  ) => {
    // Whatever the attempt did — finished, stalled on a stage, or died — the
    // receipt is the only honest account of it, so it is refetched either way.
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.deletion(variables.workspaceId) })
  },
  onSuccess: (
    result: DeleteWorkspaceTransportResult,
    variables: { readonly workspaceId: string },
  ) => {
    if (!result.ok) return
    queryClient.removeQueries({ queryKey: workspaceKeys.detail(variables.workspaceId) })
    // Drop the deleted row immediately so the list does not flash it back while
    // the refetch is in flight.
    queryClient.setQueryData<AdminSurface.CoachListResult>(workspaceKeys.list(), (current) =>
      current === undefined
        ? current
        : {
            ...current,
            coaches: current.coaches.filter((coach) => coach.id !== variables.workspaceId),
          },
    )
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.list() })
  },
})
