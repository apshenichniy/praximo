import { useState } from "react"

import { Button } from "@/components/ui/button.tsx"
import { ClientList } from "@/features/coach/components/client-list.tsx"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { Section, SectionTitle } from "@/features/mini-app/components/section.tsx"
import type { CoachClients } from "@/server/coach-clients.ts"

/**
 * The coach's home screen (#56 §Home), ordered by how often each thing is
 * needed rather than by how it was built:
 *
 * 1. the **relink banner** while the coach's bot is down (#55) — first,
 *    destructive-toned, not dismissible: putting it away does not make clients
 *    reachable;
 * 2. **clients**, with New client as the list's own first row;
 * 3. the **Main Mini App hint** last, with no section heading of its own,
 *    because a heading would promote it to the rank of Clients.
 *
 * The host's bottom button stays **empty here**. mini-app.md has already
 * promised it to «New session» on Today (#61); taking it for «New client» now
 * and moving it back later teaches a control and then withdraws it.
 */
export function CoachHome({
  copy,
  botUsername,
  mainMiniAppUrl,
  clients,
  hintVisible,
  onHideHint,
  relinkLink,
}: {
  readonly copy: CoachCopy
  readonly botUsername: string
  readonly mainMiniAppUrl: string
  readonly clients: ReadonlyArray<CoachClients.ClientSummary>
  /**
   * Whether the @BotFather hint still has a job. It disappears on its own once
   * Telegram reports `has_main_web_app`, so the manual Hide below covers only
   * the coach who decided not to bother.
   */
  readonly hintVisible: boolean
  readonly onHideHint: () => void
  /**
   * Set only while the coach's own bot has stopped answering (#55). This app is
   * the one surface that survives that — the launch is signed by Telegram, not
   * by the bot's token — so the banner is where recovery starts.
   */
  readonly relinkLink?: string
}) {
  const [hidden, setHidden] = useState(false)

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      {relinkLink === undefined ? null : (
        <section className="border-destructive/40 bg-destructive/10 mb-8 rounded-2xl border p-5">
          <h2 className="text-base font-semibold tracking-tight">{copy.home.relinkTitle}</h2>
          <p className="text-muted-foreground mt-2 text-[13px] leading-5">
            {copy.home.relinkLead}
            <span className="text-foreground">@{botUsername}</span>
            {copy.home.relinkTail}
          </p>
          <a
            className="bg-primary text-primary-foreground mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium"
            href={relinkLink}
          >
            {copy.home.relinkAction}
          </a>
        </section>
      )}

      <SectionTitle>{copy.clients.listTitle}</SectionTitle>
      <ClientList copy={copy.clients} clients={clients} />

      {!hintVisible || hidden ? null : (
        <Section className="border-border bg-card mt-10 rounded-2xl border p-5">
          <h2 className="text-base font-semibold tracking-tight">{copy.home.mainMiniAppTitle}</h2>
          <p className="text-muted-foreground mt-2 text-[13px] leading-5">
            {copy.home.mainMiniAppLead}
            <span className="text-foreground">{copy.home.mainMiniAppOpen}</span>
            {copy.home.mainMiniAppTail}
          </p>
          <p className="border-border/60 bg-background text-foreground mt-4 overflow-x-auto rounded-xl border px-3 py-2 font-mono text-[12px] break-all">
            {mainMiniAppUrl}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground mt-3 -ml-2"
            onClick={() => {
              // Optimistic on purpose: this is a preference, and a coach who
              // hid a row must not watch it sit there while a write lands.
              setHidden(true)
              onHideHint()
            }}
          >
            {copy.clients.hideHint}
          </Button>
        </Section>
      )}
    </main>
  )
}
