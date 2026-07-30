import { useNavigate, useRouter } from "@tanstack/react-router"
import {
  configureMiniAppPalette,
  DEFAULT_MINI_APP_PALETTE,
  HostNavigationProvider,
  type HostNavigation,
} from "@praximo/mini-app"
import { useMemo } from "react"

export * from "@praximo/mini-app"

/** Coach keeps its zinc-50 light ground at the shared host configuration seam. */
configureMiniAppPalette(DEFAULT_MINI_APP_PALETTE)

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
