import { CalendarAdd01Icon } from "@hugeicons-pro/core-stroke-rounded"
import { Calendar03Icon, FlagIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ClientInviteDeliveryKind, CoachLanguage } from "@praximo/domain"
import { localeTag } from "@praximo/i18n"
import { useMemo, useState } from "react"

import { HostBackButton, isIosHost } from "@/presentation-host"
import { Heading, Section, SectionTitle, Text } from "@praximo/ui"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { Card } from "@praximo/ui/components/card"
import { ToggleGroup, ToggleGroupItem } from "@praximo/ui/components/toggle-group"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { languageNames } from "@/features/i18n/coach-copy.ts"
import { ConfirmSheet } from "@/features/mini-app/components/confirm-sheet.tsx"
import { StatusBadge, type StatusTone } from "@/features/mini-app/components/status-badge.tsx"
import { DangerCard, DangerZone } from "@/features/mini-app/components/danger-zone.tsx"
import {
  DetailCard,
  DetailRow,
  PlaceholderValue,
  TimestampValue,
} from "@/features/mini-app/components/detail-card.tsx"
import { InviteLinkPanel } from "@/features/mini-app/components/invite-link-panel.tsx"
import { useCopyLink } from "@/features/mini-app/hooks/use-copy-link.ts"
import { isNotSent, sentVia, stateWord } from "@/features/coach/invite-standing.ts"
import { useTimestampFormat } from "@/features/mini-app/timestamp-format.tsx"
import type { CoachClients } from "@/server/coach-clients.ts"

/**
 * One client (#56 §Client route) — the same screen immediately after creation
 * and on return a day later.
 *
 * There is deliberately no separate success screen: the screen a coach reaches
 * tomorrow from the list and the screen they see now must not drift in copy or
 * layout, and the difference between them is nothing.
 */

/** The hero says the state as a badge; the list says it as a word (#198). */
const stateTones: Record<CoachClients.ClientDetail["state"], StatusTone> = {
  invited: "warning",
  expired: "destructive",
  accepted: "success",
}

/**
 * The two doors this screen offers (#224). `email` exists in the model for the
 * service-sent invitation (#58) and has no control here yet — it becomes the
 * third position of this segment when it lands.
 */
type Door = Extract<ClientInviteDeliveryKind, "telegram" | "link">

const isDoor = (value: string | undefined): value is Door =>
  value === "telegram" || value === "link"

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
  onShareSheet,
  onDelivered,
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
  /** The system share sheet, offered on iOS only — see `isIosHost`. */
  readonly onShareSheet: (message: string) => void
  /** A delivery that actually happened: a resolved clipboard write, here. */
  readonly onDelivered: (kind: Door) => void
  readonly onResetInvite: () => void
  readonly onDelete: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /**
   * Which door the coach is looking at (#224).
   *
   * **Local state, and it stays local**: both forms of the token are valid from
   * the moment the invitation exists, so switching shows a different address and
   * writes nothing — there is nothing to write.
   *
   * It opens on the door already recorded, when there is one. A coach who sent a
   * link last week and comes back to a screen defaulting to Telegram would be
   * reading a state word about one door beside a control set for the other.
   */
  const [door, setDoor] = useState<Door>(() =>
    isDoor(client.invite?.delivered?.kind) ? client.invite.delivered.kind : "telegram",
  )
  const invitation = client.invite === undefined ? undefined : client.invite[door]

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
   *
   * Both count as a delivery, and only once the clipboard write resolves (#224):
   * the select-text fallback hands the coach a highlighted field and no evidence
   * they did anything with it.
   */
  const timestamps = useTimestampFormat()
  const recordThisDoor = () => onDelivered(door)
  const copyLink = useCopyLink(invitation?.url, recordThisDoor)
  const copyMessage = useCopyLink(invitation?.message, recordThisDoor)

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

  /**
   * The state, and since #224 the honest version of it: an invitation nobody has
   * handed over is not «Приглашён».
   *
   * Muted rather than amber. Not-sent is the ordinary next step on a client
   * created a minute ago, and the warning tone would make every fresh client
   * look like a problem — the colour vocabulary here means *standing*, and this
   * is a to-do.
   *
   * The rule itself is shared with the list, which says the same thing as a
   * coloured word rather than a badge (#198) — two copies of it is how the two
   * surfaces start disagreeing about the same client.
   */
  const sent = client.invite?.delivered
  const standing = { state: client.state, ...(sent === undefined ? {} : { delivered: sent }) }
  const notSent = isNotSent(standing)
  const sentDoor = sentVia(copy.clients, sent?.kind)

  // Gone, not disabled: once the client is in, the invitation has no job left,
  // and the header already carries the state and the account that accepted.
  const showInvitation = client.state !== "accepted" && client.invite !== undefined

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <HostBackButton label={copy.common.back} fallbackTo="/clients" />

      <header className="flex flex-col items-center gap-2 text-center">
        <span className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-full text-xl leading-tight font-semibold">
          {initials(client.name)}
        </span>
        <Heading as="h1" role="page-title">
          {client.name}
        </Heading>
        {client.channel?.telegramUsername === undefined ? null : (
          <Text className="text-muted-foreground">@{client.channel.telegramUsername}</Text>
        )}
        <StatusBadge tone={notSent ? "muted" : stateTones[client.state]}>
          {stateWord(copy.clients, standing)}
        </StatusBadge>
        {/*
          The badge says the standing; this says what produced it (#224) — which
          door the invitation went out through, and when. A coach returning a
          week later needs both: the door is what the client is holding *and*
          where their reminders will go, and the moment is how long ago they were
          asked. The badge cannot carry either without becoming a sentence.
        */}
        {sent === undefined || sentDoor === undefined ? null : (
          <Text role="caption" className="text-muted-foreground">
            {sentDoor}
            {" · "}
            {timestamps.relative(sent.at)}
          </Text>
        )}
      </header>

      {error === undefined ? null : <Text className="text-destructive mt-6">{error}</Text>}

      {!showInvitation || client.invite === undefined || invitation === undefined ? null : (
        <Section>
          <Text
            role="caption"
            className="text-muted-foreground px-1 font-semibold tracking-wide uppercase"
          >
            {door === "link"
              ? copy.clients.invitationEyebrowLink
              : copy.clients.invitationEyebrowTelegram}
          </Text>
          <Text className="text-muted-foreground mt-2 px-1">
            {client.state === "expired" ? (
              copy.clients.reissueLead
            ) : (
              <>
                <span className="text-foreground">{client.name}</span>
                {door === "link"
                  ? copy.clients.invitationLeadTailLink
                  : copy.clients.invitationLeadTail}
              </>
            )}
          </Text>

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
              {/*
                One token, two doors (#224). The choice belongs here rather than
                on the create screen because this is where the coach finds out
                whether this person is even on Telegram — and it belongs to the
                *moment*, not to the record: switching writes nothing, because
                both forms have been valid since the invitation existed.
              */}
              <ToggleGroup
                aria-label={copy.clients.doorLabel}
                className="mt-4 w-full"
                value={[door]}
                onValueChange={(next) => {
                  // A chip tapped while already on reports an empty selection;
                  // the door stays put rather than becoming undefined.
                  if (isDoor(next[0])) setDoor(next[0])
                }}
              >
                <ToggleGroupItem value="telegram" className="flex-1" disabled={pending}>
                  {copy.clients.doorTelegram}
                </ToggleGroupItem>
                <ToggleGroupItem value="link" className="flex-1" disabled={pending}>
                  {copy.clients.doorLink}
                </ToggleGroupItem>
              </ToggleGroup>

              <div className="mt-4">
                <InviteLinkPanel
                  link={invitation.url}
                  ariaLabel={copy.clients.linkLabel}
                  controller={copyLink}
                />
              </div>

              <div className="mt-4 flex flex-col gap-2">
                {/*
                  **No card on the Link door.** A bot-authored card opens a chat
                  with a bot this client will never appear in — the whole reason
                  they are being handed a web URL. Copy is the primary action
                  there, which is also the canonical fallback everywhere (#19).
                */}
                {door === "telegram" ? (
                  <Button className="w-full" onClick={onShare} disabled={pending}>
                    {copy.clients.sendCard}
                  </Button>
                ) : null}
                <Button
                  className="w-full"
                  variant={door === "telegram" ? "outline" : "default"}
                  onClick={() => void copyMessage.copy()}
                  disabled={pending}
                >
                  {copyMessage.copied ? copy.clients.copied : copy.clients.copyInvite}
                </Button>
                {/*
                  The system share sheet, on iOS and nowhere else (#27) — gated
                  on the host platform rather than on `navigator.share`, which
                  three of the four Telegram clients get wrong in three different
                  ways. Read at render, not in an effect: this route is
                  client-only, and the host script in `<head>` ran long before it.
                */}
                {door === "link" && isIosHost() ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => onShareSheet(invitation.message)}
                    disabled={pending}
                  >
                    {copy.clients.shareAction}
                  </Button>
                ) : null}
              </div>

              {/*
                The door is also the reminder channel, and that outlives the
                sending: this line is the only place on the screen that says a
                coach picking a door is picking where this person gets reached
                for the life of the relationship.
              */}
              <Text role="caption" className="text-muted-foreground mt-3 px-1">
                {door === "link" ? copy.clients.reminderLink : copy.clients.reminderTelegram}
              </Text>
            </>
          )}
        </Section>
      )}

      <Section>
        <SectionTitle>{copy.clients.sessionsTitle}</SectionTitle>
        <Card className="mt-4 gap-0 overflow-hidden py-0">
          <ul className="divide-border divide-y">
            {client.sessions.length === 0 ? (
              <li className="text-muted-foreground px-5 py-4 text-base leading-relaxed">
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
                  <span className="flex-1 text-base leading-relaxed tabular-nums">
                    {sessionFormat.format(new Date(session.scheduledAt))}
                  </span>
                  <span className="text-muted-foreground text-xs leading-normal">
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
                className="text-primary transition-colors duration-100 active:bg-muted flex min-h-11 w-full items-center gap-3 px-5 py-4 text-left text-base leading-relaxed font-semibold"
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
            ) : // Two doors since #57, so the row has to read the kind rather than
            // assume the only one that existed when it was written. Anything
            // else is named literally — `channel.kind` is an open set, and a
            // label invented for a kind nobody has added yet would be a guess.
            client.channel.kind === "telegram" ? (
              copy.clients.channelTelegram
            ) : client.channel.kind === "email" ? (
              copy.clients.channelEmail
            ) : (
              client.channel.kind
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

      <ConfirmSheet
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
      <ConfirmSheet
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
