import { useMutation, useQueryClient } from "@tanstack/react-query"
import { WorkspaceNameMaxLength } from "@praximo/domain"
import { useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert.tsx"
import { Button } from "@/components/ui/button.tsx"
import { Card, CardContent } from "@/components/ui/card.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { TextField } from "@/features/admin/components/form-fields.tsx"
import { Section, SectionTitle } from "@/features/mini-app/components/section.tsx"
import { notifyHaptic } from "@/features/mini-app/haptics.ts"
import { requiredName } from "@/features/admin/validation.ts"
import {
  adminWorkspaceDetailQuery,
  renameWorkspaceMutation,
} from "@/features/admin/workspace-queries.ts"
import type { WorkspaceDetail } from "@/features/admin/workspace-detail.ts"

const errorMessages = {
  validation: "Check the label and try again.",
  conflict: "This coach was renamed elsewhere. Reload to see the current label.",
  server: "The rename failed. Check your connection and try again.",
} as const

/**
 * The one editable field left on the admin's side (#108). The label is the
 * admin's own name for a coach, so a pending invite has something to be called
 * before the coach's Telegram name takes over. It is not a secret — the invite
 * message titles itself with it — but it never reaches the coach's clients, and
 * the helper text says exactly that rather than promising more.
 *
 * `expectedUpdatedAt` carries optimistic concurrency, so a stale screen is
 * refused rather than silently overwriting a rename made elsewhere. The Save
 * button appears only once the field is actually dirty — a permanently enabled
 * Save on a settings screen invites a pointless write.
 */
export function LabelSettingsSection({ workspace }: { readonly workspace: WorkspaceDetail }) {
  const queryClient = useQueryClient()
  const rename = useMutation(renameWorkspaceMutation(queryClient))
  const [value, setValue] = useState(workspace.name)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)

  const validation = requiredName(value)
  const dirty = value.trim() !== workspace.name

  const save = async () => {
    if (validation !== undefined) return
    setError(undefined)
    setSaved(false)
    const result = await rename
      .mutateAsync({
        workspaceId: workspace.id,
        input: {
          requestId: crypto.randomUUID(),
          expectedUpdatedAt: workspace.updatedAt,
          name: value.trim(),
        },
      })
      .catch(() => undefined)
    if (result === undefined) {
      setError(errorMessages.server)
      notifyHaptic("error")
      return
    }
    if (!result.ok) {
      setError(errorMessages[result.error])
      notifyHaptic("error")
      return
    }
    setValue(result.value.name)
    setSaved(true)
    notifyHaptic("success")
  }

  const reload = () => {
    setError(undefined)
    void queryClient
      .fetchQuery(adminWorkspaceDetailQuery(workspace.id))
      .then((current) => setValue(current.name))
      .catch(() => setError(errorMessages.server))
  }

  return (
    <Section aria-labelledby="settings-heading">
      <SectionTitle id="settings-heading">Settings</SectionTitle>
      <Card size="sm" className="mt-4">
        <CardContent>
          <TextField
            label="Internal label"
            name="workspace-label"
            value={value}
            maxLength={WorkspaceNameMaxLength}
            placeholder="e.g. Ada Lovelace"
            error={touched ? validation : undefined}
            onBlur={() => setTouched(true)}
            onChange={(next) => {
              setValue(next)
              setSaved(false)
              setError(undefined)
            }}
          />
          <p className="text-muted-foreground mt-2 text-caption leading-5">
            Your own name for this coach: it labels them in your list and titles the invite message.
            Their clients only ever see the coach&rsquo;s own Telegram name.
          </p>

          {error === undefined ? null : (
            <Alert variant="destructive" className="bg-destructive/10 mt-4 border-transparent">
              <AlertDescription className="text-destructive">
                <p>{error}</p>
                {error === errorMessages.conflict ? (
                  <button type="button" onClick={reload} className="mt-2 font-semibold underline">
                    Reload the current label
                  </button>
                ) : null}
              </AlertDescription>
            </Alert>
          )}

          {dirty ? (
            <Button
              size="lg"
              disabled={validation !== undefined || rename.isPending}
              aria-busy={rename.isPending || undefined}
              className="mt-4 h-11 w-full font-semibold"
              onClick={() => void save()}
            >
              {rename.isPending ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : (
                "Save label"
              )}
            </Button>
          ) : saved ? (
            <p className="mt-4 text-body text-success">Label saved</p>
          ) : null}
        </CardContent>
      </Card>
    </Section>
  )
}
