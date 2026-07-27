import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { PraximoMark } from "@/components/praximo-mark.tsx"

export function AdminNotFound() {
  return (
    <MiniAppShell>
      <main className="flex min-h-svh items-center justify-center px-6 text-center">
        <div>
          <PraximoMark size={64} className="mx-auto" />
          <h1 className="mt-6 text-heading font-semibold">Page not found</h1>
        </div>
      </main>
    </MiniAppShell>
  )
}
