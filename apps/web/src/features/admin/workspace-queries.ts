import type { CreateInviteDelivery } from "@praximo/domain"
import type { QueryClient } from "@tanstack/react-query"
import { queryOptions } from "@tanstack/react-query"
import {
  createAdminCoachInvite,
  type CreateInviteTransportResult,
  deleteAdminWorkspaceRequest,
  type DeleteWorkspaceTransportResult,
  loadAdminWorkspace,
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
    confirmationName,
  }: {
    readonly workspaceId: string
    readonly requestId: string
    readonly confirmationName: string
  }): Promise<DeleteWorkspaceTransportResult> =>
    deleteAdminWorkspaceRequest({
      data: { initData, workspaceId, requestId, confirmationName },
    }),
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
