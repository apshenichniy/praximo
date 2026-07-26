import type { CoachCopy } from "@/features/i18n/coach-copy.ts"

/**
 * The stub that stands where the Today dashboard will be (#40). It says the one
 * thing a coach needs on the day they finish onboarding — the workspace is live
 * — and carries exactly one operational element.
 *
 * That element is the per-bot Mini App URL. Telegram has no API for the
 * chat-list "Open" button, so enabling it is something the coach does in
 * @BotFather themselves, and the URL to paste is bot-specific: only the app
 * knows the number. Printing it here is the difference between a runbook step a
 * coach can follow and one they cannot.
 *
 * Every word arrives as `copy`, in `member.language` (#130). The @BotFather
 * menu path inside it deliberately stays English in all three: Telegram does not
 * translate those labels, so a coach following the steps is reading them off an
 * English screen whatever language they think in.
 */
export function CoachHome({
  copy,
  botUsername,
  mainMiniAppUrl,
  relinkLink,
}: {
  readonly copy: CoachCopy
  readonly botUsername: string
  readonly mainMiniAppUrl: string
  /**
   * Set only while the coach's own bot has stopped answering (#55). This app is
   * the one surface that survives that — the launch is signed by Telegram, not
   * by the bot's token — so the banner is where recovery starts.
   */
  readonly relinkLink?: string
}) {
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
      <h1 className="text-2xl font-semibold tracking-tight text-pretty">{copy.home.title}</h1>
      <p className="text-muted-foreground mt-3 text-[15px] leading-6 text-pretty">
        {copy.home.bodyLead}
        <span className="text-foreground">@{botUsername}</span>
        {copy.home.bodyTail}
      </p>

      <section className="border-border bg-card mt-10 rounded-2xl border p-5">
        <h2 className="text-base font-semibold tracking-tight">{copy.home.mainMiniAppTitle}</h2>
        <p className="text-muted-foreground mt-2 text-[13px] leading-5">
          {copy.home.mainMiniAppLead}
          <span className="text-foreground">{copy.home.mainMiniAppOpen}</span>
          {copy.home.mainMiniAppTail}
        </p>
        <p className="border-border/60 bg-background text-foreground mt-4 overflow-x-auto rounded-xl border px-3 py-2 font-mono text-[12px] break-all">
          {mainMiniAppUrl}
        </p>
      </section>
    </main>
  )
}
