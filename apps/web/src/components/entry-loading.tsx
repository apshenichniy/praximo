import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { PraximoMark } from "@/components/praximo-mark.tsx"
import { Skeleton } from "@/components/ui/skeleton.tsx"
import { entryFrameClass } from "@/features/entry/components/entry-frame.tsx"

/**
 * What the manager Mini App shows while the entry gate resolves (#106).
 *
 * Deliberately role-neutral: this frame is painted before anyone knows who is
 * looking, so it carries the product mark and nothing else. The admin skeleton
 * it replaced named the admin surface, which for a coach or an uninvited viewer
 * was exactly the flash of protected content the gate exists to prevent.
 *
 * It borrows the entry frame so the mark lands in the same place the resolved
 * screen puts it — the answer arriving should not move the page. Hence the 80px
 * mark: the same box `entryMarkClass` gives the resolved screens' `size-20`
 * disc, so only what is inside the box changes when the role lands.
 */
export function EntryLoading() {
  return (
    <MiniAppShell>
      <main className={entryFrameClass}>
        <div className="flex flex-col items-center text-center">
          <div className="animate-pulse" role="status" aria-label="Loading Praximo">
            <PraximoMark size={80} />
          </div>
          <Skeleton className="mt-7 h-7 w-52 rounded-lg" />
          <Skeleton className="mt-4 h-4 w-64 rounded-md" />
          <Skeleton className="mt-2 h-4 w-40 rounded-md" />
        </div>
      </main>
    </MiniAppShell>
  )
}
