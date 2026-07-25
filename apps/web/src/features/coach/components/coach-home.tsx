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
 */
export function CoachHome({
  botUsername,
  mainMiniAppUrl,
}: {
  readonly botUsername: string
  readonly mainMiniAppUrl: string
}) {
  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <h1 className="text-2xl font-semibold tracking-tight text-pretty">
        Your workspace is active
      </h1>
      <p className="text-muted-foreground mt-3 text-[15px] leading-6 text-pretty">
        You are set up on <span className="text-foreground">@{botUsername}</span>. Scheduling,
        sessions and session notes arrive here next — for now, everything happens in the chat with
        your bot.
      </p>

      <section className="border-border bg-card mt-10 rounded-2xl border p-5">
        <h2 className="text-base font-semibold tracking-tight">
          Optional: open from the chat list
        </h2>
        <p className="text-muted-foreground mt-2 text-[13px] leading-5">
          In @BotFather choose your bot → Bot Settings → Configure Mini App → Enable Mini App, and
          paste this exact address. Telegram then shows an{" "}
          <span className="text-foreground">Open</span> button next to your bot in the chat list.
        </p>
        <p className="border-border/60 bg-background text-foreground mt-4 overflow-x-auto rounded-xl border px-3 py-2 font-mono text-[12px] break-all">
          {mainMiniAppUrl}
        </p>
      </section>
    </main>
  )
}
