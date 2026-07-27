import { CalendarAdd01Icon } from "@hugeicons-pro/core-stroke-rounded"
import { Calendar03Icon, FlagIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { CoachLanguage } from "@praximo/domain"
import { localeTag } from "@praximo/i18n"
import { useMemo, useState } from "react"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { Button } from "@/components/ui/button.tsx"
import { Card } from "@/components/ui/card.tsx"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { languageNames } from "@/features/i18n/coach-copy.ts"
import { ConfirmDialog } from "@/features/mini-app/components/confirm-dialog.tsx"
import { DangerCard, DangerZone } from "@/features/mini-app/components/danger-zone.tsx"
import {
  DetailCard,
  DetailRow,
  PlaceholderValue,
  TimestampValue,
} from "@/features/mini-app/components/detail-card.tsx"
import { InviteLinkPanel } from "@/features/mini-app/components/invite-link-panel.tsx"
import { Section, SectionTitle } from "@/features/mini-app/components/section.tsx"
import { useCopyLink } from "@/features/mini-app/hooks/use-copy-link.ts"
import { cn } from "@/lib/utils.ts"
import type { CoachClients } from "@/server/coach-clients.ts"

/**
 * One client (#56 §Client route) — the same screen immediately after creation
 * and on return a day later.
 *
 * There is deliberately no separate success screen: the screen a coach reaches
 * tomorrow from the list and the screen they see now must not drift in copy or
 * layout, and the difference between them is nothing.
 */

const stateStyles: Record<CoachClients.ClientDetail["state"], string> = {
  invited: "text-warning",
  expired: "text-destructive",
  accepted: "text-success",
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

export function ClientScreen({
  copy,
  language,
  client,
  onSchedule,
  onShare,
  onResetInvite,
  onDelete,
  pending,
  error,
}: {
  readonly copy: CoachCopy
  readonly language: CoachLanguage
  readonly client: CoachClients.ClientDetail
  readonly onSchedule: () => void
  readonly onShare: () => void
  readonly onResetInvite: () => void
  readonly onDelete: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /**
   * Two controllers over one invitation, deliberately.
   *
   * The panel's inline button copies the **link**, because that is the thing it
   * is showing. «Copy invite» copies the **whole forwardable message** — the
   * sentence plus the link — because a coach pasting into WhatsApp is sending a
   * message, not a URL.
   *
   * That message is not assembled here (#181). It is written to the *client*, in
   * the language the coach chose for them, and the screen around it is written
   * to the coach in theirs — two readers, two languages, and the server is where
   * the one meant for the client is put together.
   */
  const copyLink = useCopyLink(client.invite?.url)
  const copyMessage = useCopyLink(client.invite?.message)

  const sessionFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(localeTag(language), {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: client.timezone,
      }),
    [client.timezone, language],
  )

  const stateWord =
    client.state === "accepted"
      ? copy.clients.stateAccepted
      : client.state === "expired"
        ? copy.clients.stateExpired
        : copy.clients.stateInvited

  // Gone, not disabled: once the client is in, the invitation has no job left,
  // and the header already carries the state and the account that accepted.
  const showInvitation = client.state !== "accepted" && client.invite !== undefined

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <TelegramBackButton label={copy.common.back} fallbackTo="/clients" />

      <header className="flex flex-col items-center gap-2 text-center">
        <span className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-full text-heading font-semibold">
          {initials(client.name)}
        </span>
        <h1 className="text-title font-semibold tracking-tight">{client.name}</h1>
        {client.channel?.telegramUsername === undefined ? null : (
          <p className="text-muted-foreground text-body">@{client.channel.telegramUsername}</p>
        )}
        <p
          className={cn(
            "flex items-center gap-1.5 text-body font-medium",
            stateStyles[client.state],
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {stateWord}
        </p>
      </header>

      {error === undefined ? null : (
        <p className="text-destructive mt-6 text-body leading-5">{error}</p>
      )}

      {!showInvitation || client.invite === undefined ? null : (
        <Section>
          <p className="text-muted-foreground px-1 text-caption font-semibold tracking-wide uppercase">
            {copy.clients.invitationEyebrow}
          </p>
          <p className="text-muted-foreground mt-2 px-1 text-body leading-5">
            {client.state === "expired" ? (
              copy.clients.reissueLead
            ) : (
              <>
                <span className="text-foreground">{client.name}</span>
                {copy.clients.invitationLeadTail}
              </>
            )}
          </p>

          {/*
            An expired invitation offers **one** control, and it is recovery
            (#61): the link on file opens nothing, so showing it beside «Send a
            card» would be a dead end wearing the shape of an action. #56 named
            this case and left it unbuilt — the sentence above told the coach to
            issue a fresh link and nothing here did it.

            Amber rather than the danger zone's red: there is nothing live left
            to destroy, and Reset's framing would be a lie about what this does.
          */}
          {client.state === "expired" ? (
            <Button className="mt-4 w-full" onClick={onResetInvite} disabled={pending}>
              {copy.clients.reissueAction}
            </Button>
          ) : (
            <>
              <div className="mt-4">
                <InviteLinkPanel
                  link={client.invite.url}
                  ariaLabel={copy.clients.linkLabel}
                  controller={copyLink}
                />
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <Button className="w-full" onClick={onShare} disabled={pending}>
                  {copy.clients.sendCard}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void copyMessage.copy()}
                  disabled={pending}
                >
                  {copyMessage.copied ? copy.clients.copied : copy.clients.copyInvite}
                </Button>
              </div>
            </>
          )}
        </Section>
      )}

      <Section>
        <SectionTitle>{copy.clients.sessionsTitle}</SectionTitle>
        <Card className="mt-4 gap-0 overflow-hidden py-0">
          <ul className="divide-border divide-y">
            {client.sessions.length === 0 ? (
              <li className="text-muted-foreground px-5 py-4 text-body">
                {copy.clients.noSessions}
              </li>
            ) : (
              client.sessions.map((session) => (
                <li key={session.id} className="flex items-center gap-3 px-5 py-4">
                  {/*
                    Kind is a word with a glyph and no colour of its own: amber /
                    sky / emerald / rose already mean invite and session *state*,
                    and a second colour vocabulary makes both harder to read.
                  */}
                  <HugeiconsIcon
                    icon={session.kind === "intake" ? FlagIcon : Calendar03Icon}
                    size={16}
                    strokeWidth={2}
                    className="text-muted-foreground"
                  />
                  <span className="flex-1 text-body tabular-nums">
                    {sessionFormat.format(new Date(session.scheduledAt))}
                  </span>
                  <span className="text-muted-foreground text-footnote">
                    {session.kind === "intake" ? copy.clients.kindIntake : copy.clients.kindRegular}
                    {" · "}
                    {session.durationMinutes}
                    {copy.clients.durationSuffix}
                  </span>
                </li>
              ))
            )}
            <li>
              <button
                type="button"
                onClick={onSchedule}
                className="text-primary pressable-row flex min-h-11 w-full items-center gap-3 px-5 py-4 text-left text-body font-semibold"
              >
                {/*
                  The same 16px glyph column the session rows above use, so the
                  action reads as the next line of the list rather than as a
                  caption under it.
                */}
                <HugeiconsIcon icon={CalendarAdd01Icon} size={16} strokeWidth={2} />
                {copy.clients.scheduleAction}
              </button>
            </li>
          </ul>
        </Card>
      </Section>

      <Section>
        <SectionTitle>{copy.clients.profileTitle}</SectionTitle>
        <DetailCard>
          <DetailRow label={copy.clients.profileAccepted}>
            {client.acceptedAt === undefined ? (
              <PlaceholderValue>{copy.clients.pendingAccepted}</PlaceholderValue>
            ) : (
              <TimestampValue value={client.acceptedAt} empty={copy.clients.pendingAccepted} />
            )}
          </DetailRow>
          <DetailRow label={copy.clients.profileChannel}>
            {client.channel === undefined ? (
              <PlaceholderValue>{copy.clients.pendingChannel}</PlaceholderValue>
            ) : (
              copy.clients.channelTelegram
            )}
          </DetailRow>
          <DetailRow label={copy.clients.profileLanguage}>
            {client.language === undefined ? (
              <PlaceholderValue>{copy.clients.pendingLanguage}</PlaceholderValue>
            ) : (
              languageNames[client.language]
            )}
          </DetailRow>
          {/*
            The consent *text version* is deliberately absent: it is evidence for
            us and for a lawyer, it tells the coach nothing, and on screen it
            reads as a rendering bug. The date it was granted is the fact.
          */}
          <DetailRow label={copy.clients.profileConsent}>
            {client.consentGrantedAt === undefined ? (
              <PlaceholderValue>{copy.clients.pendingConsent}</PlaceholderValue>
            ) : (
              <TimestampValue value={client.consentGrantedAt} empty={copy.clients.pendingConsent} />
            )}
          </DetailRow>
        </DetailCard>
      </Section>

      <DangerZone title={copy.clients.dangerTitle}>
        {/*
          Reset is destructive because it kills a link the client is still
          holding — so it is offered only while there *is* one. Once the
          invitation has lapsed the same write is recovery, and it lives on the
          card above under its own name (#61).
        */}
        {client.state !== "invited" ? null : (
          <DangerCard
            title={copy.clients.resetTitle}
            description={copy.clients.resetBody}
            action={
              <Button
                variant="destructive"
                className="mt-4 w-full"
                disabled={pending}
                onClick={() => setConfirmReset(true)}
              >
                {copy.clients.resetAction}
              </Button>
            }
          />
        )}
        {!client.canDelete ? null : (
          <DangerCard
            title={copy.clients.deleteTitle}
            description={copy.clients.deleteBody}
            action={
              <Button
                variant="destructive"
                className="mt-4 w-full"
                disabled={pending}
                onClick={() => setConfirmDelete(true)}
              >
                {copy.clients.deleteAction}
              </Button>
            }
          />
        )}
      </DangerZone>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={copy.clients.resetTitle}
        description={copy.clients.resetBody}
        confirmLabel={copy.clients.resetConfirm}
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmReset(false)
          onResetInvite()
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={copy.clients.deleteTitle}
        description={copy.clients.deleteBody}
        confirmLabel={copy.clients.deleteConfirm}
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmDelete(false)
          onDelete()
        }}
      />
    </main>
  )
}
