import { createContext, useContext } from "react"

export interface HostNavigation {
  readonly canGoBack: () => boolean
  readonly back: () => void
  readonly replace: (to: string) => void
}

const HostNavigationContext = createContext<HostNavigation | undefined>(undefined)

/**
 * Connect the host-neutral back button to the consuming application's router.
 *
 * The package owns no router dependency: each application adapts its router to
 * these three operations at its root.
 */
export function HostNavigationProvider({
  children,
  navigation,
}: {
  readonly children: React.ReactNode
  readonly navigation: HostNavigation
}) {
  return (
    <HostNavigationContext.Provider value={navigation}>{children}</HostNavigationContext.Provider>
  )
}

export const useHostNavigation = (): HostNavigation => {
  const navigation = useContext(HostNavigationContext)
  if (navigation === undefined) {
    throw new Error("HostBackButton requires HostNavigationProvider")
  }
  return navigation
}
