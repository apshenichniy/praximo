import { Skeleton } from "@/components/ui/skeleton.tsx"

/**
 * The pending state for the details route. It exists mainly so the route stops
 * inheriting the *list's* pending screen from the `/admin` layout, which showed
 * the "Praximo Admin" hero for a moment on every tap-through — a different
 * screen entirely, which reads as a navigation mistake rather than as loading.
 *
 * The shape is the header plus two card-sized blocks: enough to hold the layout
 * still, deliberately not a per-variant replica, since which variant a coach
 * gets is exactly what has not loaded yet.
 */
export function WorkspaceDetailSkeleton() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-6 pb-16" aria-busy="true">
      <div className="mt-7 flex flex-col items-center">
        <Skeleton className="size-24 rounded-full" />
        <Skeleton className="mt-6 h-9 w-56 rounded-xl" />
        <Skeleton className="mt-3 h-6 w-36 rounded-lg" />
      </div>

      <Skeleton className="mt-12 h-8 w-24 rounded-lg" />
      <Skeleton className="mt-4 h-44 rounded-4xl" />
      <Skeleton className="mt-4 h-56 rounded-4xl" />

      <Skeleton className="mt-12 h-8 w-36 rounded-lg" />
      <Skeleton className="mt-4 h-48 rounded-4xl" />
    </main>
  )
}
