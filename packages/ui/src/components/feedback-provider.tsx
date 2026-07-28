import { createContext, useContext, type ReactNode } from "react"

import { silentFeedback, type FeedbackAdapter } from "../lib/feedback.ts"

const FeedbackContext = createContext<FeedbackAdapter>(silentFeedback)

export function FeedbackProvider({
  adapter,
  children,
}: {
  readonly adapter?: FeedbackAdapter
  readonly children: ReactNode
}) {
  return (
    <FeedbackContext.Provider value={adapter ?? silentFeedback}>
      {children}
    </FeedbackContext.Provider>
  )
}

export function useFeedback(): FeedbackAdapter {
  return useContext(FeedbackContext)
}
