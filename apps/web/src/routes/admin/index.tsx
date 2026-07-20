import { createFileRoute } from "@tanstack/react-router"

import { Button } from "@/components/ui/button.tsx"

export const Route = createFileRoute("/admin/")({ component: AdminHome })

// Admin copy is English-only (admin-surface.md): the admin is the solo operator,
// so the trilingual machinery that serves coaches never reaches these routes.
function AdminHome() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-medium">Praximo Admin</h1>
      <p className="text-muted-foreground text-sm">
        Workspace management lands with the admin auth ticket.
      </p>
      <Button>Placeholder</Button>
    </main>
  )
}
