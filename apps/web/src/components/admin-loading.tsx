import { AdminHero } from "@/components/admin-hero.tsx"
import { AdminShell } from "@/components/admin-shell.tsx"
import { Card } from "@/components/ui/card.tsx"
import { Skeleton } from "@/components/ui/skeleton.tsx"

/** Mirrors the workspace-list layout so the pending state doesn't jump. */
export function AdminLoading() {
  return (
    <AdminShell>
      <main className="mx-auto w-full max-w-2xl px-5 pt-14 pb-10">
        <AdminHero />
        <Skeleton className="mt-10 h-14 rounded-2xl" />
        <Skeleton className="mt-10 h-8 w-44 rounded-lg" />
        <Card className="divide-border mt-4 gap-0 divide-y overflow-hidden py-0">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex min-h-[78px] items-center gap-3.5 px-4 py-3.5">
              <Skeleton className="size-11 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-36 rounded-md" />
                <Skeleton className="h-3 w-24 rounded-md" />
              </div>
            </div>
          ))}
        </Card>
      </main>
    </AdminShell>
  )
}
