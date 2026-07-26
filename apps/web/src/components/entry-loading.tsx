import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { Skeleton } from "@/components/ui/skeleton.tsx"
import { entryFrameClass, entryMarkClass } from "@/features/entry/components/entry-frame.tsx"

/**
 * What the manager Mini App shows while the entry gate resolves (#106).
 *
 * Deliberately role-neutral: this frame is painted before anyone knows who is
 * looking, so it carries the product mark and nothing else. The admin skeleton
 * it replaced named the admin surface, which for a coach or an uninvited viewer
 * was exactly the flash of protected content the gate exists to prevent.
 *
 * It borrows the entry frame so the mark lands in the same place the resolved
 * screen puts it — the answer arriving should not move the page.
 */
export function EntryLoading() {
  return (
    <MiniAppShell>
      <main className={entryFrameClass}>
        <div className="flex flex-col items-center text-center">
          <div
            className={`${entryMarkClass("brand")} animate-pulse text-display font-semibold`}
            role="status"
            aria-label="Loading Praximo"
          >
            P
          </div>
          <Skeleton className="mt-7 h-7 w-52 rounded-lg" />
          <Skeleton className="mt-4 h-4 w-64 rounded-md" />
          <Skeleton className="mt-2 h-4 w-40 rounded-md" />
        </div>
      </main>
    </MiniAppShell>
  )
}
