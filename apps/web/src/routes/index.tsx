import { createFileRoute } from "@tanstack/react-router"

import { Button } from "@/components/ui/button.tsx"

export const Route = createFileRoute("/")({ component: CoachHome })

function CoachHome() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-medium">Praximo</h1>
      <p className="text-muted-foreground text-sm">The coach app is under construction.</p>
      <Button>Placeholder</Button>
    </main>
  )
}
