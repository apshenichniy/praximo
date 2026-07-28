import { queryOptions } from "@tanstack/react-query"
import { loadViewerRole } from "@/server/viewer-role.functions.ts"

export const entryKeys = {
  role: () => ["entry", "role"] as const,
}

/**
 * The entry gate's read. The credential is not part of the key — it travels on
 * the request instead (ADR 0006), and a key holding it would put a bearer
 * credential in devtools and partition the cache by a value that never changes
 * within a page load. Nothing is cached across entries either: the role is
 * re-resolved on every launch, because a stale `isAdmin` is exactly the value
 * that must not survive a revocation.
 */
export const viewerRoleQuery = () =>
  queryOptions({
    queryKey: entryKeys.role(),
    queryFn: () => loadViewerRole(),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
