import { useNavigate, useRouter } from "@tanstack/react-router"
import {
  configureMiniAppPalette,
  DEFAULT_MINI_APP_PALETTE,
  HostNavigationProvider,
  type HostNavigation,
} from "@praximo/mini-app"
import { useMemo } from "react"

export * from "@praximo/mini-app"

/**
 * Admin keeps the white light ground it shipped before the shared host move.
 * Coach uses zinc-50; this explicit application seam preserves both behaviours.
 */
configureMiniAppPalette({
  ...DEFAULT_MINI_APP_PALETTE,
  background: { dark: "#18181b", light: "#ffffff" },
  surface: { dark: "#18181b", light: "#ffffff" },
})

export function MiniAppProvider({ children }: { readonly children: React.ReactNode }) {
  const router = useRouter()
  const navigate = useNavigate()
  const navigation = useMemo<HostNavigation>(
    () => ({
      back: () => router.history.back(),
      canGoBack: () => router.history.canGoBack(),
      replace: (to) => void navigate({ to, replace: true }),
    }),
    [navigate, router],
  )

  return <HostNavigationProvider navigation={navigation}>{children}</HostNavigationProvider>
}
