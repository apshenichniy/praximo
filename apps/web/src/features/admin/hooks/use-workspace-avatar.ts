import { useEffect, useState } from "react"

import { loadAdminWorkspaceAvatar } from "@/server/admin-workspaces.functions.ts"

export interface WorkspaceAvatarState {
  readonly url: string | undefined
  readonly loading: boolean
  readonly failed: boolean
}

/**
 * Loads the workspace's custom avatar blob for display. Bump `revision` to
 * refetch after a save replaced the stored avatar.
 */
export const useWorkspaceAvatar = ({
  initData,
  workspaceId,
  hasCustomAvatar,
  revision,
}: {
  readonly initData: string
  readonly workspaceId: string
  readonly hasCustomAvatar: boolean
  readonly revision: number
}): WorkspaceAvatarState => {
  const [url, setUrl] = useState<string>()
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined
    setFailed(false)
    setUrl(undefined)
    if (!hasCustomAvatar) {
      setLoading(false)
      return
    }

    setLoading(true)
    void loadAdminWorkspaceAvatar({ data: { initData, workspaceId } }).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (!result.ok) {
        setFailed(true)
        return
      }
      const binary = atob(result.base64)
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.contentType }))
      setUrl(objectUrl)
    })

    return () => {
      cancelled = true
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [revision, initData, hasCustomAvatar, workspaceId])

  return { url, loading, failed }
}
