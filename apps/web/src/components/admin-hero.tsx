export function AdminHero() {
  return (
    <header className="flex flex-col items-center text-center">
      <div
        aria-hidden="true"
        className="admin-avatar shadow-primary/20 ring-primary/25 flex size-24 items-center justify-center rounded-full text-4xl font-semibold shadow-2xl ring-1"
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
