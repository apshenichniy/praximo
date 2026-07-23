import { AdminHero } from "@/components/admin-hero.tsx"
import { AdminThemeShell } from "@/components/admin-theme-shell.tsx"

export function AdminLoading() {
  return (
    <AdminThemeShell>
      <main className="mx-auto w-full max-w-2xl px-5 pt-14 pb-10">
        <AdminHero />
        <div className="bg-card/70 mt-10 h-14 animate-pulse rounded-2xl" />
        <div className="mt-10 h-7 w-32 animate-pulse rounded-lg bg-white/10" />
        <div className="bg-card/70 mt-4 overflow-hidden rounded-2xl">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex h-[76px] items-center gap-4 border-b border-white/6 px-4 last:border-0"
            >
              <div className="size-11 animate-pulse rounded-full bg-white/10" />
              <div className="flex-1">
                <div className="h-4 w-36 animate-pulse rounded bg-white/10" />
                <div className="mt-2 h-3 w-24 animate-pulse rounded bg-white/7" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </AdminThemeShell>
  )
}
