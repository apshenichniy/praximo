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
  retryAdminWorkspaceProfileBranding,
  updateAdminWorkspaceProfileFromForm,
  type UpdateProfileTransportResult,
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
    queryClient.setQueryData<ReadonlyArray<typeof result.value.workspace>>(
      workspaceKeys.list(),
      (current = []) => {
        const withoutCreated = current.filter(
          (workspace) => workspace.id !== result.value.workspace.id,
        )
        return [...withoutCreated, result.value.workspace]
      },
    )
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

const updateWorkspaceCaches = (
  queryClient: QueryClient,
  workspace: AdminSurface.WorkspaceDetail,
) => {
  queryClient.setQueryData(workspaceKeys.detail(workspace.id), workspace)
  queryClient.setQueryData<ReadonlyArray<AdminSurface.CreateResult["workspace"]>>(
    workspaceKeys.list(),
    (current) =>
      current?.map((item) => {
        if (item.id !== workspace.id) return item
        const updated = {
          id: item.id,
          name: workspace.name,
          botStatus: workspace.botStatus,
          hasCustomAvatar: workspace.hasCustomAvatar,
        }
        return workspace.botUsername === undefined
          ? updated
          : { ...updated, botUsername: workspace.botUsername }
      }),
  )
}

export interface UpdateWorkspaceProfileMutationInput {
  readonly workspaceId: string
  readonly input: {
    readonly requestId: string
    readonly expectedUpdatedAt: string
    readonly name: string
    readonly description: string
    readonly shortDescription: string
    readonly avatarIntent: "keep" | "replace" | "reset"
  }
  readonly avatar?: File
}

export const updateWorkspaceProfileMutation = (initData: string, queryClient: QueryClient) => ({
  mutationFn: async ({
    workspaceId,
    input,
    avatar,
  }: UpdateWorkspaceProfileMutationInput): Promise<UpdateProfileTransportResult> => {
    const data = new FormData()
    data.set("initData", initData)
    data.set("workspaceId", workspaceId)
    data.set("input", JSON.stringify(input))
    if (avatar !== undefined) data.set("avatar", avatar)
    return updateAdminWorkspaceProfileFromForm({ data })
  },
  onSuccess: (result: UpdateProfileTransportResult) => {
    if (!result.ok) return
    updateWorkspaceCaches(queryClient, result.value.workspace)
  },
})

export const retryWorkspaceBrandingMutation = (initData: string, queryClient: QueryClient) => ({
  mutationFn: ({
    workspaceId,
    retryAvatar,
  }: {
    readonly workspaceId: string
    readonly retryAvatar: boolean
  }) => retryAdminWorkspaceProfileBranding({ data: { initData, workspaceId, retryAvatar } }),
  onSuccess: (result: UpdateProfileTransportResult) => {
    if (!result.ok) return
    updateWorkspaceCaches(queryClient, result.value.workspace)
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
    queryClient.setQueryData<ReadonlyArray<AdminSurface.CreateResult["workspace"]>>(
      workspaceKeys.list(),
      (current) => current?.filter((workspace) => workspace.id !== variables.workspaceId),
    )
  },
})
