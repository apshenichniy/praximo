import { CalendarAdd01Icon, Link02Icon, TelegramIcon } from "@hugeicons-pro/core-stroke-rounded"
import { Calendar03Icon, FlagIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  type ClientInviteDoor,
  type CoachLanguage,
  ClientInviteDoor as InviteDoors,
} from "@praximo/domain"
import { localeTag } from "@praximo/i18n"
import { useMemo, useState } from "react"

import { HostBackButton, isIosHost } from "@/mini-app.tsx"
import { Heading, Section, SectionTitle, SegmentedChoice, Text } from "@praximo/ui"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { Card } from "@praximo/ui/components/card"
import { PersonAvatar } from "@praximo/ui/custom/person-avatar"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { languageNames } from "@/features/i18n/coach-copy.ts"
import { InviteEmailSheet } from "@/features/coach/components/invite-email-sheet.tsx"
import { ConfirmSheet } from "@/features/mini-app/components/confirm-sheet.tsx"
import { StatusBadge, type StatusTone } from "@/features/mini-app/components/status-badge.tsx"
import { DangerCard, DangerZone } from "@/features/mini-app/components/danger-zone.tsx"
import {
  DetailCard,
  DetailRow,
  PlaceholderValue,
  TimestampValue,
} from "@/features/mini-app/components/detail-card.tsx"
import { useClientPhoto } from "@/features/coach/use-client-photo.ts"
import { useCopyLink } from "@/features/mini-app/hooks/use-copy-link.ts"
import { doorFor, isNotSent, sentVia, stateWord } from "@/features/coach/invite-standing.ts"
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
 * What each door *offers*, as data rather than as a branch per control (#224).
 *
 * The words live in the copy catalogue keyed the same way; this is the other
 * half — the places where the doors differ in behaviour rather than in wording,
 * and each difference has one reason:
 *
 * - **No card behind the Link door.** A bot-authored card opens a chat with a
 *   bot this client will never appear in, which is the whole reason they are
 *   being handed a web URL instead. Copy takes over as the primary action, which
 *   is also the canonical fallback everywhere (#19).
 * - **The share sheet only where the link travels by hand.** A Telegram
 *   invitation already has a native picker behind Send a card; offering the
 *   system sheet beside it would be two ways to open two pickers.
 * - **The service-sent email only behind the Link door** (#58). It is not a
 *   third position on the segment: an email is not a form of the token a coach
 *   hands over, it is us sending the *web* URL for them. Telegram's door already
 *   has a transport and no use for an address.
 * - **An icon each**, which is presentation rather than behaviour but varies with
 *   the door exactly as the rest of this table does. It sits on the invitation
 *   card's header beside an eyebrow that already reads «Приглашение · Telegram»,
 *   so the glyph confirms the word rather than replacing it.
 */
const doorOffers: Record<
  ClientInviteDoor,
  {
    readonly card: boolean
    readonly shareSheet: boolean
    readonly email: boolean
    /**
     * Which of them is the filled button — one per door, and the rest are ghosts.
     *
     * It follows the channel model rather than the mechanism: a client is on
     * Telegram or reachable by address, and this door exists because they are
     * not on Telegram. So behind Link the canonical act is *us sending it to an
     * address*, and a pasted link is the escape that avoids having to ask for
     * one. Copy led here until #58's send had somewhere to go; leaving it in
     * front made the exception the default.
     */
    readonly lead: "card" | "email"
    readonly icon: typeof TelegramIcon
  }
> = {
  telegram: { card: true, shareSheet: false, email: false, lead: "card", icon: TelegramIcon },
  link: { card: false, shareSheet: true, email: true, lead: "email", icon: Link02Icon },
}

export function ClientScreen({
  copy,
  language,
  client,
  onSchedule,
  onShare,
  onShareSheet,
  onDelivered,
  onSendEmail,
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
  readonly onDelivered: (kind: ClientInviteDoor) => void
  /**
   * The service-sent invitation (#58) — the one delivery this screen asks for
   * rather than reports, because nothing has happened until the server answers.
   */
  readonly onSendEmail: (address: string) => void
  readonly onResetInvite: () => void
  readonly onDelete: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const photo = useClientPhoto(client.id, client.hasAvatar)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [emailSheet, setEmailSheet] = useState(false)
  /**
   * The address the last attempt was made with, kept because nothing was written
   * (#58).
   *
   * The whole design is that a failed send persists nothing — which is what makes
   * a retry safe, and also what means the server has no memory of what the coach
   * typed. Without this, «Адрес не принят. Проверьте его и попробуйте ещё раз»
   * would send them back to a field holding the *old* address, or none at all,
   * and the one thing they need to see is the typo they are being asked to fix.
   *
   * Cleared by nothing: a success re-reads the screen, and `invite.address` then
   * holds the same string this does.
   */
  const [lastAttempt, setLastAttempt] = useState<string>()
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
   *
   * `doorFor` and not the delivery kind itself: a service-sent email put the
   * *web* URL in that message, so it opens the Link door (#58).
   */
  const [door, setDoor] = useState<ClientInviteDoor>(() => doorFor(client.invite?.delivered?.kind))
  const invitation = client.invite === undefined ? undefined : client.invite[door]
  // Everything that differs between the doors, looked up once: the words from
  // the catalogue, the two behaviours from the table above.
  const words = copy.clients.doors[door]
  const offers = doorOffers[door]

  /**
   * One controller, over the **whole forwardable message** — the sentence plus
   * the link — because a coach pasting into WhatsApp is sending a message, not
   * a URL.
   *
   * There were two until the URL left this screen. A read-only field held it,
   * with its own inline button copying the bare link, and neither earned its
   * place: truncated to the width of a phone the field hid the token, which is
   * the only part that differs between two clients, so it verified nothing and
   * nobody retyped it. What it did carry was the select-fallback — silently,
   * which is why the fallback is now a sentence instead (`copyFailed`).
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
  const inviteCard = showInvitation && client.invite !== undefined && invitation !== undefined

  /**
   * One line for both refusals, because a coach can only act on one at a time
   * and the server's answer is the one that outranks.
   *
   * It reads inside the card rather than over the page: every way of failing
   * here belongs to a control in that card, and a red sentence floating under
   * the name reads as something wrong with the *client*. The page keeps it only
   * for the case where there is no card to put it in.
   */
  const notice = error ?? (copyMessage.failed ? copy.clients.copyFailed : undefined)

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <HostBackButton label={copy.common.back} fallbackTo="/clients" />

      <header className="flex flex-col items-center gap-2 text-center">
        {/*
          The same disc as the roster's rows, at the size a header wants: the client's
          own photo where the platform captured one at acceptance (#231), and their
          initials — which is the ordinary case, and the design — where it did not.
        */}
        <PersonAvatar
          name={client.name}
          {...(photo === undefined ? {} : { photoSrc: photo })}
          size="page"
        />
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
            {/*
              And *where*, for the one route that has an address (#58). Without
              it a typo is unfindable: the coach reads «отправлено», the client
              never arrives, and nothing on any screen says the message went to
              `ann@gmial.com`.
            */}
            {sent.kind === "email" && client.invite?.address !== undefined ? (
              <>
                {" · "}
                {copy.clients.sentToPrefix}
                {client.invite.address}
              </>
            ) : null}
          </Text>
        )}
      </header>

      {inviteCard || notice === undefined ? null : (
        <Text className="text-destructive mt-6">{notice}</Text>
      )}

      {!inviteCard || client.invite === undefined || invitation === undefined ? null : (
        <Section>
          {/*
            Chrome and body, and the split is the point.

            The door switch used to sit in the content, as two `min-h-11` chips
            filled with `bg-primary` — 44px of brand violet directly above a 36px
            primary button. A control that only changes which view you are
            looking at outranked the one that hands the invitation over. Weight
            alone could have been retuned; instead the switch left the content
            for the card's own header strip, so it cannot come back into the
            running as copy grows.

            Ringed rather than tinted, and that costs nothing it was not already
            paying: `Item variant="muted"` is `bg-muted/50`, which over
            `--background` composites to exactly `--card`. The fill was always
            the same as Sessions and Profile — only the hairline was missing, and
            with it the invitation joins the family instead of sitting outside it.
          */}
          <Card className="mt-4 gap-0 overflow-hidden py-0">
            <div className="border-border flex h-12 items-center gap-2.5 border-b px-4">
              <HugeiconsIcon
                icon={offers.icon}
                size={16}
                strokeWidth={2}
                className="text-muted-foreground shrink-0"
              />
              {/*
                Door-independent since the segment moved in beside it (#224):
                «Приглашение · Telegram» next to a chip reading «Telegram» is the
                same word twice, and the strip is the tightest row on the screen.
              */}
              <Text
                role="caption"
                className="text-muted-foreground min-w-0 flex-1 truncate font-semibold uppercase"
              >
                {copy.clients.inviteEyebrow}
              </Text>
              {/*
                One token, two doors (#224). The choice belongs to this screen
                rather than to the create screen because this is where the coach
                finds out whether this person is even on Telegram — and it
                belongs to the *moment*, not to the record: switching writes
                nothing, because both forms have been valid since the invitation
                existed.

                Gone once the link has lapsed: with one recovery action left
                there is no second view to switch to.
              */}
              {client.state === "expired" ? null : (
                <div
                  role="group"
                  aria-label={copy.clients.doorLabel}
                  className="flex shrink-0 gap-0.5"
                >
                  {InviteDoors.literals.map((value) => (
                    <SegmentedChoice
                      key={value}
                      size="sm"
                      selected={door === value}
                      disabled={pending}
                      onClick={() => setDoor(value)}
                    >
                      {copy.clients.doors[value].label}
                    </SegmentedChoice>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 px-4 pt-3.5 pb-4">
              {notice === undefined ? null : <Text className="text-destructive">{notice}</Text>}

              <Text className="text-muted-foreground">
                {client.state === "expired" ? (
                  copy.clients.reissueLead
                ) : (
                  <>
                    <span className="text-foreground">{client.name}</span>
                    {words.leadTail}
                  </>
                )}
              </Text>

              {/*
                An expired invitation offers **one** control, and it is recovery
                (#61): the link on file opens nothing, so showing it beside «Send
                a card» would be a dead end wearing the shape of an action. #56
                named this case and left it unbuilt — the sentence above told the
                coach to issue a fresh link and nothing here did it.

                Ordinary rather than the danger zone's red: there is nothing live
                left to destroy, and Reset's framing would be a lie about what
                this does.
              */}
              {client.state === "expired" ? (
                <Button size="lg" className="w-full" onClick={onResetInvite} disabled={pending}>
                  {copy.clients.reissueAction}
                </Button>
              ) : (
                <>
                  {/*
                    One filled button per door and ghosts under it. Outline gave
                    every action an edge, which made the stack read as a list of
                    equals; the block's whole complaint was that nothing in it
                    led.
                  */}
                  <div className="flex flex-col gap-1">
                    {offers.lead === "card" ? (
                      <Button size="lg" className="w-full" onClick={onShare} disabled={pending}>
                        {copy.clients.sendCard}
                      </Button>
                    ) : (
                      /*
                        The one control on this screen that asks the service to do
                        the sending (#58), and behind this door the canonical one.
                        It reads «ещё раз» once an address is on file, because by
                        then a coach pressing it is answering «не дошло» rather
                        than sending for the first time.
                      */
                      <Button
                        size="lg"
                        className="w-full"
                        onClick={() => setEmailSheet(true)}
                        disabled={pending}
                      >
                        {client.invite.address === undefined
                          ? copy.clients.sendEmail
                          : copy.clients.sendEmailAgain}
                      </Button>
                    )}

                    {/* The canonical fallback everywhere (#19), and never the lead. */}
                    <Button
                      variant="ghost"
                      className="w-full"
                      onClick={() => void copyMessage.copy()}
                      disabled={pending}
                    >
                      {copyMessage.copied ? copy.clients.copied : copy.clients.copyInvite}
                    </Button>

                    {/*
                      The iOS gate is the *host platform*, never `navigator.share`,
                      which three of the four Telegram clients get wrong in three
                      different ways (#27). Read at render rather than in an
                      effect: this route is client-only, and the host script in
                      `<head>` ran long before it.
                    */}
                    {offers.shareSheet && isIosHost() ? (
                      <Button
                        variant="ghost"
                        className="w-full"
                        onClick={() => onShareSheet(invitation.message)}
                        disabled={pending}
                      >
                        {copy.clients.shareAction}
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </Card>
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
        cancelLabel={copy.clients.cancel}
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
        cancelLabel={copy.clients.cancel}
        confirmLabel={copy.clients.deleteConfirm}
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmDelete(false)
          onDelete()
        }}
      />
      <InviteEmailSheet
        copy={copy.clients}
        open={emailSheet}
        onOpenChange={setEmailSheet}
        // The last attempt wins over the address on file: after a refusal the
        // field must still hold the address the error is about. Otherwise it is
        // the one on file, which survives a reissue (#58) — a resend after «не
        // дошло» should not cost the coach a retype.
        suggested={lastAttempt ?? client.invite?.address}
        pending={pending}
        onSend={(address) => {
          setLastAttempt(address)
          setEmailSheet(false)
          onSendEmail(address)
        }}
      />
    </main>
  )
}
