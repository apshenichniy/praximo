import { type CoachLanguage, CoachLanguages, ClientNameMaxLength } from "@praximo/domain"
import { useState } from "react"

import { HostBackButton } from "@/presentation-host"
import { HostMainButton } from "@/presentation-host"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { Input } from "@praximo/ui/components/input"
import { Label } from "@praximo/ui/components/label"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { languageNames } from "@/features/i18n/coach-copy.ts"
import { ActionBar } from "@/features/mini-app/components/action-bar.tsx"
import { ChoiceChip, Heading } from "@praximo/ui"

/**
 * New client (#56 §New client) — one screen, one commit.
 *
 * A name, the invitation-language chips, and the host's bottom button as the
 * single action. The client and the invitation are created together, so this
 * screen has no draft state to come back to.
 */
export function NewClientScreen({
  copy,
  coachLanguage,
  onCreate,
  onBack,
  pending,
  error,
}: {
  readonly copy: CoachCopy
  /** The chips default to the coach's own language — the likeliest answer. */
  readonly coachLanguage: CoachLanguage
  readonly onCreate: (input: {
    readonly name: string
    readonly inviteLanguage: CoachLanguage
  }) => void
  readonly onBack: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const [name, setName] = useState("")
  const [inviteLanguage, setInviteLanguage] = useState<CoachLanguage>(coachLanguage)
  const trimmed = name.trim()

  const submit = () => {
    if (trimmed.length === 0 || pending) return
    onCreate({ name: trimmed, inviteLanguage })
  }

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-28">
      <HostBackButton onBack={onBack} label={copy.common.back} />
      <Heading as="h1" role="page-title">
        {copy.clients.newTitle}
      </Heading>

      <div className="mt-8 flex flex-col gap-2">
        <Label htmlFor="client-name">{copy.clients.nameLabel}</Label>
        <Input
          id="client-name"
          value={name}
          maxLength={ClientNameMaxLength}
          autoComplete="off"
          placeholder={copy.clients.namePlaceholder}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="mt-8 flex flex-col gap-2">
        <Label>{copy.clients.languageLabel}</Label>
        <div className="flex gap-2">
          {CoachLanguages.map((option) => (
            // The haptic is the chip's own now: `ChoiceChip` emits `selection`
            // through the shared feedback adapter, and only when the tap
            // actually changes the answer — which is what the guard here used
            // to do by hand.
            <ChoiceChip
              key={option}
              className="flex-1"
              selected={inviteLanguage === option}
              onClick={() => setInviteLanguage(option)}
            >
              {languageNames[option]}
            </ChoiceChip>
          ))}
        </div>
        {/*
          Without this line, «Language» on a screen titled with a person's name
          reads as *that person's* language — the coach picks wrong and never
          finds out.
        */}
        <p className="text-muted-foreground text-xs leading-normal leading-5">
          {copy.clients.languageHintLead}
          {trimmed.length === 0 ? (
            copy.clients.languageHintFallback
          ) : (
            <>
              <span className="text-foreground">{trimmed}</span>
              {copy.clients.languageHintTail}
            </>
          )}
        </p>
      </div>

      {error === undefined ? null : (
        <p className="text-destructive mt-6 text-base leading-relaxed leading-5">{error}</p>
      )}

      <HostMainButton
        text={pending ? copy.common.working : copy.clients.createAction}
        onClick={submit}
        fallback={
          <ActionBar>
            <Button className="w-full" disabled={trimmed.length === 0 || pending} onClick={submit}>
              {pending ? copy.common.working : copy.clients.createAction}
            </Button>
          </ActionBar>
        }
      />
    </main>
  )
}
