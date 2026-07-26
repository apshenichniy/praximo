import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button.tsx"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer.tsx"
import { TextField } from "@/features/admin/components/form-fields.tsx"
import { notifyHaptic } from "@/features/admin/haptics.ts"
import { inviteEmail } from "@/features/admin/validation.ts"

/** RFC 5321's ceiling for a whole address — a stop, not a budget, so no counter. */
const EmailMaxLength = 254

/**
 * Bottom drawer for the Email channel (#105): the one field this channel needs
 * that the other two don't. The language lives on the screen behind it (#164),
 * where it is chosen once for the coach rather than once per channel.
 *
 * The address is checked here, on send, so a typo is caught while the sheet is
 * still open and the keyboard is still up. Once it has complained, it
 * re-checks on every keystroke: the error must disappear as the manager fixes
 * it, not on a second failed tap.
 */
export function InviteEmailSheet({
  open,
  onOpenChange,
  onSend,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSend: (delivery: { readonly email: string }) => void
}) {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string>()

  // Reopening starts clean: a stale address from the previous coach is the one
  // thing this sheet must never send.
  useEffect(() => {
    if (!open) return
    setEmail("")
    setError(undefined)
  }, [open])

  const send = () => {
    const problem = inviteEmail(email)
    setError(problem)
    if (problem !== undefined) {
      notifyHaptic("error")
      return
    }
    onSend({ email: email.trim() })
  }

  return (
    <Drawer open={open} showSwipeHandle onOpenChange={onOpenChange}>
      <DrawerContent className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <DrawerHeader className="p-0 pt-2 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <DrawerTitle className="text-lg font-semibold">Send by email</DrawerTitle>
          <DrawerDescription>
            They&rsquo;ll get a link that opens the onboarding in Telegram.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-5 pt-5">
          <TextField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            maxLength={EmailMaxLength}
            placeholder="ada@lovelace.coach"
            error={error}
            onChange={(next) => {
              setEmail(next)
              if (error !== undefined) setError(inviteEmail(next))
            }}
            onBlur={() => {
              // Silent on an untouched field: leaving a sheet's only input on
              // the way out is not a mistake worth flagging.
              if (email.trim().length > 0) setError(inviteEmail(email))
            }}
          />

          <Button size="lg" className="h-13 w-full font-semibold" onClick={send}>
            Send invite
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
