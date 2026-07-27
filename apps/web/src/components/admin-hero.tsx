import { PraximoMark } from "@/components/praximo-mark.tsx"

export function AdminHero() {
  return (
    <header className="flex flex-col items-center text-center">
      <PraximoMark size={96} />
      <h1 className="mt-7 text-display font-semibold tracking-tight">Praximo Admin</h1>
      <p className="text-muted-foreground mt-3 max-w-sm text-pretty text-body leading-6">
        Manage coach workspaces, Telegram bots, and onboarding.
      </p>
    </header>
  )
}
