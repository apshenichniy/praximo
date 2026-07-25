import type { CoachLanguage } from "@praximo/domain"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import {
  prepareCoachInviteShareMutation,
  recordCoachInviteShareMutation,
} from "@/features/admin/workspace-queries.ts"
import { loadTelegramWebApp, shareInviteMessage, type ShareInviteOutcome } from "@/lib/telegram.ts"

export interface InviteShareInput {
  readonly inviteId: string
  readonly link: string
  /** The full forwardable message; the pre-8.0 fallback text. */
  readonly message: string
  readonly language: CoachLanguage
}

/**
 * The Telegram share, in the one shape both the invite screen and the coaches
 * list need: mint a prepared inline message on tap, hand it to the native chat
 * picker, and record the delivery only once the share actually landed.
 *
 * - `"no-telegram"` — the host has no Mini App bridge (a plain browser).
 * - `"dismissed"` — the picker was cancelled. Not a failure: the invite is
 *   untouched and tapping again is safe.
 * - `"failed"` — the prepared message could not be minted; retryable.
 */
export type InviteShareResult = ShareInviteOutcome | "no-telegram" | "failed"

export interface InviteShareController {
  readonly share: (input: InviteShareInput) => Promise<InviteShareResult>
  /** The invite currently mid-share, for a per-row busy state. */
  readonly sharingInviteId: string | undefined
}

export const useInviteShare = (): InviteShareController => {
  const prepareMutation = useMutation(prepareCoachInviteShareMutation())
  const recordMutation = useMutation(recordCoachInviteShareMutation())
  const [sharingInviteId, setSharingInviteId] = useState<string>()

  const share = async (input: InviteShareInput): Promise<InviteShareResult> => {
    const webApp = await loadTelegramWebApp()
    if (webApp === undefined) return "no-telegram"

    setSharingInviteId(input.inviteId)
    try {
      const outcome = await shareInviteMessage(webApp, {
        prepare: async () => {
          const prepared = await prepareMutation.mutateAsync({
            inviteId: input.inviteId,
            language: input.language,
          })
          if (!prepared.ok) throw new Error(prepared.error)
          return prepared.value.preparedMessageId
        },
        link: input.link,
        message: input.message,
      })
      if (outcome === "dismissed") return outcome
      // Best-effort bookkeeping: the invite has already left, so a failure here
      // must never read to the admin as a failed share.
      await recordMutation
        .mutateAsync({ inviteId: input.inviteId, language: input.language })
        .catch(() => undefined)
      return outcome
    } catch {
      return "failed"
    } finally {
      setSharingInviteId(undefined)
    }
  }

  return { share, sharingInviteId }
}
