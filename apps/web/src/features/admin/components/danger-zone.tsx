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

export function DangerZone({
  workspaceName,
  open,
  confirmationName,
  error,
  disabled,
  pending,
  onOpenChange,
  onConfirmationNameChange,
  onDelete,
}: {
  readonly workspaceName: string
  readonly open: boolean
  readonly confirmationName: string
  readonly error: string | undefined
  readonly disabled: boolean
  readonly pending: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirmationNameChange: (value: string) => void
  readonly onDelete: () => void
}) {
  return (
    <Section aria-labelledby="danger-zone-heading">
      <SectionTitle id="danger-zone-heading" className="text-destructive">
        Danger zone
      </SectionTitle>
      <Card size="sm" className="border-destructive/40 bg-destructive/5 mt-4 border shadow-none">
        <CardContent>
          <p className="text-base font-semibold">Delete workspace permanently</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Deletes the workspace, its clients, sessions, transcripts, artifacts, and custom
            uploads. This cannot be undone.
          </p>
          {disabled ? (
            <p className="text-muted-foreground mt-3 text-sm">
              Save or discard profile changes before deleting this workspace.
            </p>
          ) : null}
          <Button
            variant="destructive"
            size="lg"
            disabled={disabled}
            className="mt-5 font-semibold"
            onClick={() => onOpenChange(true)}
          >
            Delete workspace
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{workspaceName}”?</AlertDialogTitle>
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
    </Section>
  )
}
