export const feedbackEvents = [
  "selection",
  "impact-light",
  "impact-medium",
  "success",
  "error",
] as const

export type FeedbackEvent = (typeof feedbackEvents)[number]

export interface FeedbackAdapter {
  readonly emit: (event: FeedbackEvent) => void
}

export const silentFeedback: FeedbackAdapter = {
  emit: () => undefined,
}
