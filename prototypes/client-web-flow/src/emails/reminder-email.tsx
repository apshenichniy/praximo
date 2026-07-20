// PROTOTYPE — React Email template for the session-reminder email (wayfinder #28).
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
import { client, coach, joinTokens, session, urls } from "@/lib/mock"

export function ReminderEmail({ locale }: { locale: Locale }) {
  const t = dict[locale]
  const joinUrl = urls.join(joinTokens.client)
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{t.remPreview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <Text style={styles.eyebrow}>Praximo</Text>
            <Heading as="h1" style={styles.heading}>
              {t.remHeading(client.firstName)}
            </Heading>
            <Text style={styles.text}>{t.remBody(coach.name)}</Text>
            <Section style={styles.sessionBox}>
              <Text style={styles.sessionKind}>{t.sessionKindIntake}</Text>
              <Text style={styles.sessionTime}>
                23.07.2026, 10:00 · {t.minutes(session.durationMin)}
              </Text>
            </Section>
            <Button href={joinUrl} style={styles.button}>
              {t.remCta}
            </Button>
            <Text style={styles.fallback}>{t.remFallback}</Text>
            <Link href={joinUrl} style={styles.link}>
              {joinUrl}
            </Link>
          </Section>
          <Hr style={styles.hr} />
          <Text style={styles.footer}>{t.remFooter(coach.name)}</Text>
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
    margin: "0 0 20px",
  },
  sessionBox: {
    backgroundColor: "#fafafa",
    border: "1px solid #e4e4e7",
    borderRadius: "10px",
    margin: "0 0 24px",
    padding: "14px 18px",
  },
  sessionKind: {
    color: "#18181b",
    fontSize: "14px",
    fontWeight: 600,
    margin: 0,
  },
  sessionTime: { color: "#52525b", fontSize: "13px", margin: "2px 0 0" },
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
