import type { ReactNode } from "react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx"
import { Button } from "@/components/ui/button.tsx"
import { Card, CardContent } from "@/components/ui/card.tsx"
import { Field, FieldError, FieldLabel } from "@/components/ui/field.tsx"
import { Input } from "@/components/ui/input.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { Section, SectionTitle } from "@/features/admin/components/section.tsx"
import { displayName } from "@/features/admin/formatting.ts"

/** The one place on the details screen where an action cannot be taken back. */
export function DangerZone({ children }: { readonly children: ReactNode }) {
  return (
    <Section aria-labelledby="danger-zone-heading">
      <SectionTitle id="danger-zone-heading" className="text-destructive">
        Danger zone
      </SectionTitle>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </Section>
  )
}

function DangerCard({
  title,
  description,
  action,
}: {
  readonly title: string
  readonly description: ReactNode
  readonly action: ReactNode
}) {
  return (
    <Card size="sm" className="border-destructive/40 bg-destructive/5 border shadow-none">
      <CardContent>
        <p className="text-base font-semibold">{title}</p>
        <p className="text-muted-foreground mt-2 text-sm leading-5">{description}</p>
        {action}
      </CardContent>
    </Card>
  )
}

/**
 * Reset in one confirmed gesture (#107): the old code is cancelled and a fresh
 * one is minted together, so a workspace is never left without a live invite.
 * This card is the *destructive* half — resetting a live or accepted invite
 * costs the coach the link they already hold. Reissuing an invite that is
 * already dead is recovery and lives on the invite card instead.
 */
export function ResetInviteCard({
  copy,
  pending,
  onOpen,
}: {
  readonly copy: { readonly label: string; readonly description: string }
  readonly pending: boolean
  readonly onOpen: () => void
}) {
  return (
    <DangerCard
      title={copy.label}
      description={copy.description}
      action={
        <Button
          variant="destructive"
          size="lg"
          disabled={pending}
          aria-busy={pending || undefined}
          className="mt-5 font-semibold"
          onClick={onOpen}
        >
          {pending ? (
            <>
              <Spinner /> Issuing…
            </>
          ) : (
            copy.label
          )}
        </Button>
      }
    />
  )
}

export function DeleteWorkspaceCard({
  workspaceName,
  open,
  confirmationName,
  error,
  pending,
  onOpenChange,
  onConfirmationNameChange,
  onDelete,
}: {
  readonly workspaceName: string
  readonly open: boolean
  readonly confirmationName: string
  readonly error: string | undefined
  readonly pending: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirmationNameChange: (value: string) => void
  readonly onDelete: () => void
}) {
  return (
    <>
      <DangerCard
        title="Delete workspace permanently"
        description="Deletes the workspace, its clients, sessions, transcripts, artifacts, and custom uploads. This cannot be undone."
        action={
          <Button
            variant="destructive"
            size="lg"
            className="mt-5 font-semibold"
            onClick={() => onOpenChange(true)}
          >
            Delete workspace
          </Button>
        }
      />

      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{displayName(workspaceName)}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes all workspace data. To confirm, enter the workspace name
              exactly as shown.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field data-invalid={error === undefined ? undefined : true}>
            <FieldLabel htmlFor="delete-confirmation-name">Workspace name</FieldLabel>
            <Input
              id="delete-confirmation-name"
              value={confirmationName}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error === undefined ? undefined : true}
              onChange={(event) => onConfirmationNameChange(event.target.value)}
            />
            {error === undefined ? null : <FieldError>{error}</FieldError>}
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending || confirmationName !== workspaceName}
              aria-busy={pending || undefined}
              onClick={onDelete}
            >
              {pending ? (
                <>
                  <Spinner /> Deleting…
                </>
              ) : (
                "Delete permanently"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
