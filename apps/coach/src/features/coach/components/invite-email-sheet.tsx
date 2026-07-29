import { useEffect, useState } from "react"

import { EmailAddressMaxLength, readEmailAddress } from "@praximo/domain"
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
 * The padding every sheet in this app carries — and load-bearing here in a way
 * it is nowhere else: this is the only sheet whose action sits under a *text
 * field*, so the on-screen keyboard rises under the button. A bare `pb-4` left
 * it touching the keys. `max()` keeps 24px of air on a device with no home
 * indicator and yields to the inset on one that has it.
 */
const sheetPadding = "px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"

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
  /**
   * What the field opens on: the address on file (`invite.address`, which
   * survives a reissue), or the one an attempt just failed on.
   */
  readonly suggested: string | undefined
  readonly pending: boolean
  readonly onSend: (address: string) => void
}) {
  useOpenHaptic(open)
  const [address, setAddress] = useState(suggested ?? "")
  const [invalid, setInvalid] = useState(false)

  // Reopening starts from `suggested`, which is the address on file *or* the one
  // the last attempt failed on — the screen decides which, and the difference
  // matters: «Адрес не принят. Проверьте его» has to point at a field that still
  // holds the address it is talking about, not at an empty one.
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
      <DrawerContent className={sheetPadding}>
        {/*
          Left-aligned, like every other sheet in this app: the drawer centres by
          default on a vertical swipe axis, and a centred title over a
          left-aligned form label reads as two different sheets stacked.
        */}
        <DrawerHeader className="p-0 pt-2 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <DrawerTitle>{copy.emailSheet.title}</DrawerTitle>
          <DrawerDescription>{copy.emailSheet.description}</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-5 pt-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-email">{copy.emailSheet.label}</Label>
            <Input
              id="invite-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={copy.emailSheet.placeholder}
              // RFC 5321's ceiling for a whole address — a stop, not a budget,
              // so there is no counter beside it.
              maxLength={EmailAddressMaxLength}
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
