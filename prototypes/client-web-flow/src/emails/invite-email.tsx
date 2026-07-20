// PROTOTYPE — React Email template for the invite email (wayfinder #28).
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components"
import { dict, type Locale } from "@/lib/i18n"
import { client, coach, urls } from "@/lib/mock"

export function InviteEmail({
  locale,
  inviteToken,
}: {
  locale: Locale
  inviteToken: string
}) {
  const t = dict[locale]
  const inviteUrl = urls.invite(inviteToken)
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{t.invitePreview(coach.name)}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <Text style={styles.eyebrow}>Praximo</Text>
            <Heading as="h1" style={styles.heading}>
              {t.inviteHeading(coach.name)}
            </Heading>
            <Text style={styles.text}>
              {t.inviteBody(coach.name, client.firstName)}
            </Text>
            <Button href={inviteUrl} style={styles.button}>
              {t.inviteCta}
            </Button>
            <Text style={styles.fallback}>{t.inviteFallback}</Text>
            <Link href={inviteUrl} style={styles.link}>
              {inviteUrl}
            </Link>
          </Section>
          <Hr style={styles.hr} />
          <Text style={styles.footer}>{t.inviteFooter(coach.shortName)}</Text>
        </Container>
      </Body>
    </Html>
  )
}

const styles = {
  body: {
    backgroundColor: "#f4f4f5",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    margin: 0,
    padding: "24px 0",
  },
  container: { margin: "0 auto", maxWidth: "480px", padding: "0 16px" },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "32px",
  },
  eyebrow: {
    color: "#71717a",
    fontSize: "12px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    margin: "0 0 16px",
  },
  heading: {
    color: "#18181b",
    fontSize: "22px",
    fontWeight: 600,
    lineHeight: "28px",
    margin: "0 0 12px",
  },
  text: {
    color: "#3f3f46",
    fontSize: "15px",
    lineHeight: "23px",
    margin: "0 0 24px",
  },
  button: {
    backgroundColor: "#18181b",
    borderRadius: "999px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "15px",
    fontWeight: 500,
    padding: "12px 24px",
    textDecoration: "none",
  },
  fallback: {
    color: "#a1a1aa",
    fontSize: "13px",
    margin: "24px 0 4px",
  },
  link: { color: "#2563eb", fontSize: "13px", wordBreak: "break-all" as const },
  hr: { borderColor: "#e4e4e7", margin: "24px 0 16px" },
  footer: {
    color: "#a1a1aa",
    fontSize: "12px",
    lineHeight: "18px",
    margin: 0,
  },
}
