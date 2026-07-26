import { Alert, AlertDescription } from "@/components/ui/alert.tsx"
import { Button } from "@/components/ui/button.tsx"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { Textarea } from "@/components/ui/textarea.tsx"

/**
 * Bottom drawer for the Copy channel: copy the full forwardable message. When
 * the webview denies programmatic clipboard access after the async round-trip,
 * the message itself appears with a retry button — that press is a direct user
 * gesture, which always works.
 *
 * The language is the screen's, not this sheet's (#164): it now decides what
 * the coach's setup speaks, so it cannot be a per-channel afterthought.
 */
export function InviteCopySheet({
  open,
  onOpenChange,
  pending,
  error,
  fallbackMessage,
  onCopy,
  onCopyFallback,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly pending: boolean
  readonly error?: string | undefined
  readonly fallbackMessage?: string | undefined
  readonly onCopy: () => void
  readonly onCopyFallback: (message: string) => void
}) {
  return (
    <Drawer
      open={open}
      showSwipeHandle
      onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}
    >
      <DrawerContent className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <DrawerHeader className="p-0 pt-2 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <DrawerTitle className="text-lg font-semibold">Copy invite</DrawerTitle>
          <DrawerDescription>
            The full invite message is copied — paste it anywhere: WhatsApp, Slack, SMS.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-5 pt-5">
          {fallbackMessage === undefined ? (
            <>
              {error === undefined ? null : (
                <Alert variant="destructive" className="bg-destructive/10 border-transparent">
                  <AlertDescription className="text-destructive">{error}</AlertDescription>
                </Alert>
              )}

              <Button
                size="lg"
                className="h-13 w-full font-semibold"
                disabled={pending}
                aria-busy={pending || undefined}
                onClick={() => onCopy()}
              >
                {pending ? (
                  <>
                    <Spinner /> Preparing…
                  </>
                ) : (
                  "Copy invite message"
                )}
              </Button>
            </>
          ) : (
            <>
              <Alert className="border-transparent">
                <AlertDescription>
                  Automatic copy was blocked by the browser. Tap Copy below, or long-press the
                  message to copy it manually.
                </AlertDescription>
              </Alert>
              {error === undefined ? null : (
                <Alert variant="destructive" className="bg-destructive/10 border-transparent">
                  <AlertDescription className="text-destructive">{error}</AlertDescription>
                </Alert>
              )}
              <Textarea
                readOnly
                value={fallbackMessage}
                rows={6}
                className="bg-muted rounded-2xl p-4 text-sm"
                onFocus={(event) => event.target.select()}
              />
              <Button
                size="lg"
                className="h-13 w-full font-semibold"
                onClick={() => onCopyFallback(fallbackMessage)}
              >
                Copy
              </Button>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
