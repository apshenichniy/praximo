import { queryOptions } from "@tanstack/react-query"
import { loadViewerRole } from "@/server/viewer-role.functions.ts"

export const entryKeys = {
  role: (initData: string) => ["entry", "role", initData] as const,
}

/**
 * The entry gate's read. Keyed by the credential so a re-launch under a
 * different Telegram identity can never reuse the previous viewer's answer, and
 * never cached across entries: the role is re-resolved on every launch, because
 * a stale `isAdmin` is exactly the value that must not survive a revocation.
 */
export const viewerRoleQuery = (initData: string) =>
  queryOptions({
    queryKey: entryKeys.role(initData),
    queryFn: () => loadViewerRole({ data: { initData } }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
