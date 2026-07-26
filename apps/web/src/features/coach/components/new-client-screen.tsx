import { type CoachLanguage, CoachLanguages, ClientNameMaxLength } from "@praximo/domain"
import { useState } from "react"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { TelegramMainButton } from "@/components/telegram-main-button.tsx"
import { Button } from "@/components/ui/button.tsx"
import { Input } from "@/components/ui/input.tsx"
import { Label } from "@/components/ui/label.tsx"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { languageNames } from "@/features/i18n/coach-copy.ts"
import { ActionBar } from "@/features/mini-app/components/action-bar.tsx"
import { cn } from "@/lib/utils.ts"

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
      <TelegramBackButton onBack={onBack} label={copy.common.back} />
      <h1 className="text-2xl font-semibold tracking-tight">{copy.clients.newTitle}</h1>

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
            <button
              key={option}
              type="button"
              aria-pressed={inviteLanguage === option}
              onClick={() => setInviteLanguage(option)}
              className={cn(
                "flex-1 rounded-full border py-2 text-sm font-semibold transition-colors",
                inviteLanguage === option
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "border-border text-muted-foreground",
              )}
            >
              {languageNames[option]}
            </button>
          ))}
        </div>
        {/*
          Without this line, «Language» on a screen titled with a person's name
          reads as *that person's* language — the coach picks wrong and never
          finds out.
        */}
        <p className="text-muted-foreground text-xs leading-5">
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
        <p className="text-destructive mt-6 text-sm leading-5">{error}</p>
      )}

      <TelegramMainButton
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
