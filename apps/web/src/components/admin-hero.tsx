export function AdminHero() {
  return (
    <header className="flex flex-col items-center text-center">
      <div
        aria-hidden="true"
        className="from-primary/95 shadow-primary/20 ring-primary/25 flex size-24 items-center justify-center rounded-full bg-gradient-to-br to-violet-950 text-4xl font-semibold text-white shadow-2xl ring-1"
      >
        P
      </div>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">Praximo Admin</h1>
      <p className="text-muted-foreground mt-3 max-w-sm text-pretty text-[15px] leading-6">
        Manage coach workspaces, Telegram bots, and onboarding.
      </p>
    </header>
  )
}
