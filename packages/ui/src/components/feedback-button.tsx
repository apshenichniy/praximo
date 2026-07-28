import type { ComponentProps } from "react"

import type { FeedbackEvent } from "../lib/feedback.ts"
import { useFeedback } from "./feedback-provider.tsx"
import { Button } from "./ui/button.tsx"

type FeedbackButtonProps = ComponentProps<typeof Button> & {
  feedback?: FeedbackEvent | false
}

function FeedbackButton({ feedback = "impact-light", onClick, ...props }: FeedbackButtonProps) {
  const adapter = useFeedback()

  return (
    <Button
      {...props}
      data-praximo-feedback-button=""
      onClick={(event) => {
        if (feedback !== false) adapter.emit(feedback)
        onClick?.(event)
      }}
    />
  )
}

export { FeedbackButton, type FeedbackButtonProps }
