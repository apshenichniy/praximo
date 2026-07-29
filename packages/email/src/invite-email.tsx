import type { CoachLanguage } from "@praximo/domain"
import { localeTag } from "@praximo/i18n"
import { Body } from "@react-email/body"
import { Button } from "@react-email/button"
import { Container } from "@react-email/container"
import { Head } from "@react-email/head"
import { Hr } from "@react-email/hr"
import { Html } from "@react-email/html"
import { Img } from "@react-email/img"
import { Link } from "@react-email/link"
import { Preview } from "@react-email/preview"
import { Section } from "@react-email/section"
import { Text } from "@react-email/text"

import { inviteEmailCopy } from "./invite-email-copy.ts"

/**
 * The invitation email (#58).
 *
 * **Never imports `@react-email/components`.** That barrel pulls in
 * `@react-email/tailwind`, whose module-level initialisation builds a CSS engine
 * and blows the Workers startup-CPU budget before a single request arrives —
 * react-email#1508, a deploy-time crash rather than a failing test. Individual
 * packages only, and styling is plain objects, which is what email needs anyway:
 * inline styles are the format, not a compromise.
 *
 * **A fixed light ground.** Email clients invert dark mode themselves, each
 * differently and none of them asking; `prefers-color-scheme` is unreliable and
 * partially-inverted mail looks broken in a way no-theme mail does not. Two
 * palettes here would be two ways to lose.
 *
 * **What the email deliberately does not carry:**
 * - *session details* — a sent email cannot be corrected, and a session can be
 *   rescheduled or cancelled (#62); the Acceptance Page is where the truth
 *   lives, and a frozen copy of it would one day quietly lie;
 * - *the coach's photo* — an image needs a public URL, which would make #225 a
 *   dependency of this ticket for decoration;
 * - *the Telegram door* — the coach chose email, so they have already answered
 *   that question, and two doors is a choice the client cannot make informedly.
 */

/**
 * The Maia light theme, converted to sRGB.
 *
 * Every value below is one of `packages/ui/src/styles.css`'s `:root` tokens
 * mechanically converted from `oklch()` — no email client understands that
 * function, and a colour invented here would be a second palette drifting from
 * the one the Acceptance Page renders in. Which token each is stays written
 * down, so a theme change has something to grep for.
 */
const Ink = "#09090b" // --foreground
const Muted = "#71717b" // --muted-foreground
const Accent = "#7008e7" // --primary
const OnAccent = "#f5f3ff" // --primary-foreground
const Ground = "#ffffff" // --background
const Rule = "#e4e4e7" // --border
const Backdrop = "#f4f4f5" // --muted

const body = {
  backgroundColor: Backdrop,
  margin: 0,
  padding: "24px 0",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
} as const

const container = {
  backgroundColor: Ground,
  borderRadius: "10px",
  margin: "0 auto",
  maxWidth: "520px",
  padding: "32px",
} as const

const heading = {
  color: Ink,
  fontSize: "24px",
  fontWeight: 620,
  letterSpacing: "-0.02em",
  lineHeight: "32px",
  margin: "0 0 16px",
} as const

const lead = {
  color: Ink,
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 28px",
} as const

const button = {
  backgroundColor: Accent,
  // `--radius`, which is 0.625rem — spelled in px because email has no root em
  // to resolve against.
  borderRadius: "10px",
  color: OnAccent,
  display: "inline-block",
  fontSize: "16px",
  fontWeight: 600,
  padding: "13px 24px",
  textDecoration: "none",
} as const

const fallback = {
  color: Muted,
  fontSize: "13px",
  lineHeight: "20px",
  margin: "28px 0 0",
} as const

/**
 * `anywhere` rather than `break-all`: a token is twelve symbols and the origin is
 * short, so the URL only needs permission to wrap, not to be chopped mid-word.
 */
const url = {
  color: Accent,
  fontSize: "13px",
  lineHeight: "20px",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
} as const

const expiry = {
  color: Muted,
  fontSize: "13px",
  lineHeight: "20px",
  margin: "8px 0 0",
} as const

const rule = { borderColor: Rule, margin: "32px 0 20px" } as const

const footerText = {
  color: Muted,
  fontSize: "12px",
  lineHeight: "18px",
  margin: "0 0 4px",
} as const

/** The wordmark beside the image, so the brand survives with images blocked. */
const wordmark = {
  color: Ink,
  fontSize: "14px",
  fontWeight: 620,
  letterSpacing: "-0.02em",
  margin: "0 0 8px",
  verticalAlign: "middle",
} as const

const mark = { display: "inline-block", marginRight: "8px", verticalAlign: "middle" } as const

export interface InviteEmailProps {
  readonly locale: CoachLanguage
  /** The coach's own name, dropped into a nominative slot and never inflected. */
  readonly coachName: string
  /** The Acceptance Page URL — this email is the Link door's other transport. */
  readonly acceptanceUrl: string
  /**
   * Absolute URL of the brand mark. A PNG served by the Client app, because
   * Gmail strips SVG and `PraximoMark` cannot travel as itself.
   */
  readonly markUrl: string
}

export function InviteEmail({ locale, coachName, acceptanceUrl, markUrl }: InviteEmailProps) {
  const copy = inviteEmailCopy(locale)
  return (
    <Html lang={localeTag(locale)}>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={heading}>{copy.heading(coachName)}</Text>
          <Text style={lead}>{copy.lead}</Text>
          <Button href={acceptanceUrl} style={button}>
            {copy.action}
          </Button>
          <Text style={fallback}>
            {copy.linkFallback}
            <br />
            <Link href={acceptanceUrl} style={url}>
              {acceptanceUrl}
            </Link>
          </Text>
          <Text style={expiry}>{copy.expiry}</Text>
          <Hr style={rule} />
          <Section>
            {/*
             * `alt` is load-bearing, not decoration: most inboxes block remote
             * images by default, and the footer has to read as the brand for a
             * client who never unblocks them.
             */}
            <Text style={wordmark}>
              <Img alt="Praximo" height="20" src={markUrl} style={mark} width="20" />
              Praximo
            </Text>
            <Text style={footerText}>{copy.footer.about}</Text>
            <Text style={footerText}>{copy.footer.noReply}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
