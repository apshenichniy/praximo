import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { Heading, PraximoMark } from "@praximo/ui"

export function AdminNotFound() {
  return (
    <MiniAppShell>
      <main className="flex min-h-svh items-center justify-center px-6 text-center">
        <div>
          <PraximoMark size={64} className="mx-auto" />
          <Heading as="h1" role="page-title" className="mt-6">
            Page not found
          </Heading>
        </div>
      </main>
    </MiniAppShell>
  )
}
