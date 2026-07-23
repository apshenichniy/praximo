import { queryOptions } from "@tanstack/react-query"
import { loadAdminWorkspaces } from "@/server/admin-workspaces.functions.ts"

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
