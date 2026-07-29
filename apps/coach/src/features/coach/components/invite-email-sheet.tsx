import { useEffect, useState } from "react"

import { readEmailAddress } from "@praximo/domain"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@praximo/ui/components/drawer"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"

import { Input } from "@praximo/ui/components/input"
import { Label } from "@praximo/ui/components/label"
import { Text } from "@praximo/ui"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { notifyHaptic, useOpenHaptic } from "@/presentation-host"

/**
 * The address the service sends this client's invitation to (#58).
 *
 * The Admin section's sheet (#105) is the shape this follows, with **one
 * deliberate divergence**: that one opens empty every time, because a different
 * coach stands behind it on each open and a stale address is the one thing it
 * must never send. Here it is always the same client, and the address is one the
 * coach has already given us — so it opens pre-filled, and a resend after «не
 * дошло» is one tap.
 *
 * The check here is a courtesy to the typist, not the fence: the server reads
 * the same `readEmailAddress`, and Cloudflare has the last word on whether an
 * address is deliverable at all.
 */
export function InviteEmailSheet({
  copy,
  open,
  onOpenChange,
  suggested,
  pending,
  onSend,
}: {
  readonly copy: ClientsCopy
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The address on file, from `invite.address` — survives a reissue. */
  readonly suggested: string | undefined
  readonly pending: boolean
  readonly onSend: (address: string) => void
}) {
  useOpenHaptic(open)
  const [address, setAddress] = useState(suggested ?? "")
  const [invalid, setInvalid] = useState(false)

  // Reopening starts from what we know rather than from what was typed last
  // time: a coach who mistyped, closed the sheet and came back should meet the
  // address on file again, not their own typo.
  useEffect(() => {
    if (!open) return
    setAddress(suggested ?? "")
    setInvalid(false)
  }, [open, suggested])

  const send = () => {
    const valid = readEmailAddress(address)
    if (valid === undefined) {
      setInvalid(true)
      notifyHaptic("error")
      return
    }
    setInvalid(false)
    onSend(valid)
  }

  return (
    <Drawer open={open} showSwipeHandle onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{copy.emailSheet.title}</DrawerTitle>
          <DrawerDescription>{copy.emailSheet.description}</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-email">{copy.emailSheet.label}</Label>
            <Input
              id="invite-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={copy.emailSheet.placeholder}
              value={address}
              // Once it has complained, it re-checks on every keystroke: the
              // error must clear as the coach fixes it, not on a second failed tap.
              onChange={(event) => {
                setAddress(event.target.value)
                if (invalid) setInvalid(readEmailAddress(event.target.value) === undefined)
              }}
              disabled={pending}
            />
            {invalid ? <Text className="text-destructive">{copy.emailSheet.invalid}</Text> : null}
          </div>
          <Button className="w-full" onClick={send} disabled={pending}>
            {copy.emailSheet.action}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
