import {
  Alert01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { CoachLanguage } from "@praximo/domain"
import { Heading, Text, cn } from "@praximo/ui"
import { Link } from "@tanstack/react-router"
import { useMemo } from "react"

import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { Card } from "@praximo/ui/components/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@praximo/ui/components/item"
import { SessionKindLine } from "@/features/coach/components/session-kind-line.tsx"
import { sessionClock } from "@/features/coach/session-days.ts"
import { workingHoursLine } from "@/features/coach/working-hours-line.ts"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { Section, SectionTitle } from "@praximo/ui"
import { useTimestampFormat } from "@/features/mini-app/timestamp-format.tsx"
import type { CoachSessions } from "@/server/coach-sessions.ts"

/**
 * Today — the Mini App's entrance (#61), ordered by how often each thing is
 * needed rather than by the order mini-app.md lists it in:
 *
 * 1. the **re-link banner** while the coach's bot is down (#55) — first,
 *    destructive-toned, never dismissible;
 * 2. the **greeting**: the coach's name and one factual line, the zero spoken;
 * 3. **today's sessions as cards**, all of them, each tapping through;
 * 4. **needs attention**, hidden when empty and holding only invitations that
 *    have lapsed or are inside their last two days;
 * 5. **bottom navigation** — three rows in one card, not actions;
 * 6. the **Main Mini App hint**, last, as one row with no heading of its own.
 *
 * Three of mini-app.md's five blocks are deliberately **absent rather than
 * empty**: the artifacts feed and generation failures wait for #44, the join
 * button for #42. A section that exists and is always empty promises something
 * the coach then hunts for.
 */
export function TodayScreen({
  copy,
  language,
  today,
  botUsername,
  relinkLink,
  onResend,
  resending,
  error,
}: {
  readonly copy: CoachCopy
  readonly language: CoachLanguage
  readonly today: CoachSessions.TodayView
  readonly botUsername: string
  /** Set only while the coach's own bot has stopped answering (#55). */
  readonly relinkLink?: string
  readonly onResend: (clientId: string) => void
  /** The client whose invitation is being sent again, while it is in flight. */
  readonly resending: string | undefined
  readonly error: string | undefined
}) {
  const clock = useMemo(() => sessionClock(language, today.timezone), [language, today.timezone])

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-28">
      {relinkLink === undefined ? null : (
        <section className="border-destructive/40 bg-destructive/10 mb-8 rounded-2xl border p-5">
          <Heading as="h2" role="card-title">
            {copy.home.relinkTitle}
          </Heading>
          <Text role="caption" className="text-muted-foreground mt-2">
            {copy.home.relinkLead}
            <span className="text-foreground">@{botUsername}</span>
            {copy.home.relinkTail}
          </Text>
          <a
            className="bg-primary text-primary-foreground mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl text-base leading-relaxed font-medium"
            href={relinkLink}
          >
            {copy.home.relinkAction}
          </a>
        </section>
      )}

      <header>
        <Heading as="h1" role="page-title" className="truncate">
          {today.coachName}
        </Heading>
        {/*
          The count line is silent on an empty practice, and only there: with no
          clients at all the checklist below is the whole screen, and «No
          sessions today» would be the first of three ways of saying nothing.
          For everybody else the zero is spoken — silence about it reads as a
          screen that failed to load.
        */}
        {today.emptyPractice ? null : (
          <Text className="text-muted-foreground mt-1">
            {copy.today.sessionsToday(today.sessions.length)}
          </Text>
        )}
      </header>

      {error === undefined ? null : (
        <p className="text-destructive mt-6 text-base leading-5">{error}</p>
      )}

      {today.emptyPractice ? (
        <FirstSteps copy={copy} />
      ) : (
        <>
          <div className="mt-8 flex flex-col gap-3">
            {today.sessions.map((session) => (
              <SessionCard
                key={session.id}
                copy={copy}
                session={session}
                time={clock.format(new Date(session.scheduledAt))}
                onResend={onResend}
                pending={resending === session.clientId}
              />
            ))}
          </div>

          {today.attention.length === 0 ? null : (
            <Section className="mt-10">
              <SectionTitle>{copy.today.attentionTitle}</SectionTitle>
              <Card className="mt-3 gap-0 overflow-hidden py-0">
                <ul className="divide-border divide-y">
                  {today.attention.map((item) => (
                    <li key={item.clientId}>
                      <AttentionRow copy={copy} item={item} />
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>
          )}
        </>
      )}

      {/*
        Navigation as three rows in one card, and the availability row is why
        (#210).

        Two of them were outline buttons standing on the page ground, and that
        worked only while the page was white. `variant="outline"` is
        `border-border bg-background` — its fill *is* the page's fill, by
        definition — so a white button on a white page was carried by its edge
        alone and nobody noticed the missing surface. Once the light scheme's page
        receded the same pair became outlined holes in a tinted band, beside cards
        that had just gained a raise. No colour fixes that: an outline button can
        never be raised above a ground it is painted from.

        A row has no such problem, because the card is what is raised and the row
        is inside it. #210 had already chosen this shape for availability, and the
        constraint it named for keeping the other two out was width: a third
        *button* wants 98 of the 109 points three of them leave. Rows stack. Width
        stops being the limit, and the reason availability became a row is the
        reason these two are rows now.

        Ordered by how often a coach opens them — two weekly errands, then the one
        opened twice a year. The chevron is the other thing a button never said:
        that this leads somewhere rather than doing something.
      */}
      <nav className="mt-10">
        <Card className="gap-0 overflow-hidden py-0">
          <ul className="divide-border divide-y">
            <li>
              <NavRow
                to="/sessions"
                icon={Calendar03Icon}
                label={copy.today.allSessions}
                value={copy.today.allSessionsHint}
              />
            </li>
            <li>
              <NavRow
                to="/clients"
                icon={UserMultipleIcon}
                label={copy.today.clients}
                value={copy.today.clientsHint}
              />
            </li>
            <li>
              <NavRow
                to="/availability"
                icon={Clock01Icon}
                label={copy.availability.title}
                value={workingHoursLine(today.workingHours, copy.availability, language)}
              />
            </li>
          </ul>
        </Card>
      </nav>

      {/*
        One row reading as its payoff rather than its mechanism, opening the
        screen that carries the steps and the address. **Hide lives there**, so
        Today has no dismiss control at all: a row a coach can put away from the
        dashboard is a row they put away without reading, and `has_main_web_app`
        already dismisses it for everybody who did the steps.
      */}
      {!today.mainMiniAppHintVisible ? null : (
        <Card className="mt-8 gap-0 overflow-hidden py-0">
          <Link
            to="/main-mini-app"
            className="transition-colors duration-100 active:bg-muted flex items-center gap-4 px-5 py-4 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base leading-relaxed font-medium">
                {copy.home.mainMiniAppRow}
              </span>
              <span className="text-muted-foreground mt-0.5 block truncate text-xs leading-normal">
                {copy.home.mainMiniAppRowMeta}
              </span>
            </span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={18}
              strokeWidth={2}
              className="text-muted-foreground shrink-0"
            />
          </Link>
        </Card>
      )}
    </main>
  )
}

/**
 * One session of today.
 *
 * A set of cards rather than a hero plus a folded-away line — the owner's call
 * over the reviewer's (#61): a set of cards is what a person expects from a day
 * and reads without instruction, and «and 3 more» on a four-row dashboard is
 * economy for its own sake.
 */
function SessionCard({
  copy,
  session,
  time,
  onResend,
  pending,
}: {
  readonly copy: CoachCopy
  readonly session: CoachSessions.SessionSummary
  readonly time: string
  readonly onResend: (clientId: string) => void
  readonly pending: boolean
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      {/*
        `size="sm"` rather than the `xs` the navigation rows use: this is the
        screen's subject and a session gets more room than a way out of it.

        The time keeps its own type — `text-xl` tabular-nums — and rides the media
        slot, which is what that slot is for: the thing you identify the row by
        before you read it. What changes underneath it is only the second line,
        from `text-xs` to `ItemDescription`'s `text-sm`, and `SessionKindLine`
        takes that through its own `className` the way `session-screen` already
        does. The size is the slot's to decide, not the line's.
      */}
      <Item
        render={<Link to="/sessions/$sessionId" params={{ sessionId: session.id }} />}
        size="sm"
        className="active:bg-muted rounded-none px-5"
      >
        <ItemMedia>
          <span className="text-xl leading-tight font-semibold tabular-nums">{time}</span>
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>{session.clientName}</ItemTitle>
          <ItemDescription>
            <SessionKindLine
              copy={copy.clients}
              kind={session.kind}
              durationMinutes={session.durationMinutes}
              className="text-sm leading-normal"
            />
          </ItemDescription>
        </ItemContent>
      </Item>

      {/*
        Amber, not red. Red belongs to the bot being down — the one thing here a
        coach cannot fix by talking to their client — and spending it on somebody
        who has simply not tapped a link yet teaches them to discount it.
      */}
      {session.clientAccepted ? null : (
        <div className="border-border/60 border-t bg-warning/10 px-5 py-3">
          <p className="text-xs leading-5 text-warning">
            {copy.today.unacceptedLead}
            <span className="font-semibold">{session.clientName}</span>
            {copy.today.unacceptedTail}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={pending}
            onClick={() => onResend(session.clientId)}
          >
            {copy.today.resend}
          </Button>
        </div>
      )}
    </Card>
  )
}

/**
 * One row of the navigation card, composed from `Item` rather than hand-rolled.
 *
 * `variant="default"` and `size="xs"`: no fill, a transparent border and the
 * tightest padding the primitive offers, because the fill and the edge belong to
 * the card around all three. A row that carried its own would be a box in a box.
 *
 * Every row has a second line, so the three are one height. Availability states
 * its hours — #210's argument, and the shape the other two are aimed at: a row
 * that answers its own question without being opened. Sessions and Clients say
 * what is behind them instead, because `TodayView` carries neither a client count
 * nor a session total, and a number invented here would be worse than a true
 * sentence. When the view carries them, they go in this same slot.
 *
 * Glyphs are the marks each thing already wears: a calendar for sessions, the
 * same one a session row carries; two figures rather than a group for clients,
 * because a coach's clients are individuals seen one at a time and not a team; a
 * clock for the hours, which is what availability is.
 *
 * `active:bg-muted` is the caller's, not the primitive's: `Item` ships
 * `[a]:hover:bg-muted`, and hover is not an event a phone has.
 */
function NavRow({
  to,
  icon,
  label,
  value,
}: {
  readonly to: "/sessions" | "/clients" | "/availability"
  readonly icon: typeof Clock01Icon
  readonly label: string
  readonly value: string
}) {
  return (
    <Item
      render={<Link to={to} />}
      size="xs"
      className="active:bg-muted min-h-14 rounded-none px-5"
    >
      <ItemMedia>
        <HugeiconsIcon
          icon={icon}
          size={18}
          strokeWidth={2}
          className="text-muted-foreground shrink-0"
        />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{label}</ItemTitle>
        <ItemDescription>{value}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={18}
          strokeWidth={2}
          className="text-muted-foreground shrink-0"
        />
      </ItemActions>
    </Item>
  )
}

/**
 * An invitation about to lapse, or one that already has — the only two things
 * this section carries. Each row deep-links to the client it is about, which is
 * where every control over that invitation lives.
 *
 * The same `Item` at the same `size="xs"` as the navigation rows below, because it
 * is the same shape in the same kind of card: one glyph, a name, a line about it,
 * and a chevron. Sharing the size is what keeps the two cards on one rhythm.
 *
 * The amber belongs to the *sentence*, not to the slot, which is why it is a span
 * inside `ItemDescription` rather than a class on it. `ItemDescription` owns
 * `text-muted-foreground`, and the contract in `docs/agents/ui-development.md`
 * does not let a caller repaint a primitive — but what goes *in* a slot styles
 * itself. Please do not tidy this into `className="text-warning"`.
 */
function AttentionRow({
  copy,
  item,
}: {
  readonly copy: CoachCopy
  readonly item: CoachSessions.AttentionInvite
}) {
  const format = useTimestampFormat()
  return (
    <Item
      render={<Link to="/clients/$clientId" params={{ clientId: item.clientId }} />}
      size="xs"
      className="active:bg-muted min-h-14 rounded-none px-5"
    >
      <ItemMedia>
        <HugeiconsIcon
          icon={Alert01Icon}
          size={18}
          strokeWidth={2}
          className="shrink-0 text-warning"
        />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{item.clientName}</ItemTitle>
        <ItemDescription>
          <span className="text-warning">
            {item.expired
              ? copy.today.attentionExpired
              : `${copy.today.attentionExpiringPrefix}${format.relative(item.expiresAt)}`}
          </span>
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={18}
          strokeWidth={2}
          className="text-muted-foreground shrink-0"
        />
      </ItemActions>
    </Item>
  )
}

/**
 * The three steps of a practice that has nothing in it yet.
 *
 * The bot step opens **already ticked**: the coach finished it a minute ago, and
 * a checklist that opens at zero reads as work waiting rather than work done.
 * The whole thing disappears the moment a client exists — a completed checklist
 * is decoration occupying the best space on the screen.
 */
function FirstSteps({ copy }: { readonly copy: CoachCopy }) {
  const steps = [
    { title: copy.today.checklistBot, body: copy.today.checklistBotBody, done: true },
    { title: copy.today.checklistClient, body: copy.today.checklistClientBody, done: false },
    { title: copy.today.checklistSession, body: copy.today.checklistSessionBody, done: false },
  ]

  return (
    <Section className="mt-8">
      <SectionTitle>{copy.today.checklistTitle}</SectionTitle>
      <Card className="mt-3 gap-0 overflow-hidden py-0">
        <ol className="divide-border divide-y">
          {steps.map((step, index) => (
            <li key={step.title} className="flex items-start gap-4 px-5 py-4">
              {step.done ? (
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  size={20}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-success"
                />
              ) : (
                <span className="border-border text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs leading-normal font-semibold tabular-nums">
                  {index + 1}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-base leading-relaxed font-medium",
                    step.done && "text-muted-foreground line-through",
                  )}
                >
                  {step.title}
                </span>
                <span className="text-muted-foreground mt-0.5 block text-xs leading-normal leading-5">
                  {step.body}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </Section>
  )
}
