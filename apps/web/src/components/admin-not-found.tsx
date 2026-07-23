import { AdminThemeShell } from "@/components/admin-theme-shell.tsx"

export function AdminNotFound() {
  return (
    <AdminThemeShell>
      <main className="flex min-h-svh items-center justify-center px-6 text-center">
        <div>
          <div className="bg-card ring-border mx-auto flex size-16 items-center justify-center rounded-full text-2xl font-semibold ring-1">
            P
          </div>
          <h1 className="mt-6 text-xl font-semibold">Page not found</h1>
        </div>
      </main>
    </AdminThemeShell>
  )
}
