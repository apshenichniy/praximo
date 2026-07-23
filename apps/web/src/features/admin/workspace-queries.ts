import type { QueryClient } from "@tanstack/react-query"
import { queryOptions } from "@tanstack/react-query"
import {
  createAdminWorkspaceFromForm,
  type CreateWorkspaceTransportResult,
  loadAdminWorkspaces,
} from "@/server/admin-workspaces.functions.ts"

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

export interface CreateWorkspaceMutationInput {
  readonly input: {
    readonly requestId: string
    readonly name: string
    readonly coachLanguage: string
    readonly description: string
    readonly shortDescription: string
  }
  readonly avatar?: File
}

export const createWorkspaceMutation = (initData: string, queryClient: QueryClient) => ({
  mutationFn: async ({
    input,
    avatar,
  }: CreateWorkspaceMutationInput): Promise<CreateWorkspaceTransportResult> => {
    const data = new FormData()
    data.set("initData", initData)
    data.set("input", JSON.stringify(input))
    if (avatar !== undefined) data.set("avatar", avatar)
    return createAdminWorkspaceFromForm({ data })
  },
  onSuccess: (result: CreateWorkspaceTransportResult) => {
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
