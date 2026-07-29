export { Heading, type HeadingProps } from "./components/heading.tsx"
export { ChoiceChip, type ChoiceChipProps } from "./components/choice-chip.tsx"
export { FeedbackButton, type FeedbackButtonProps } from "./components/feedback-button.tsx"
export { PraximoMark } from "./components/praximo-mark.tsx"
export { FeedbackProvider, useFeedback } from "./components/feedback-provider.tsx"
export { Section, SectionTitle } from "./components/section.tsx"
export { SegmentedChoice, type SegmentedChoiceProps } from "./components/segmented-choice.tsx"
export { Text, type TextProps } from "./components/text.tsx"
export {
  feedbackEvents,
  silentFeedback,
  type FeedbackAdapter,
  type FeedbackEvent,
} from "./lib/feedback.ts"
export { prefersReducedMotion, type ReducedMotionPreference } from "./lib/motion.ts"
export {
  interfaceTypographyRoles,
  typographyRecipe,
  type InterfaceTypographyRole,
  type TypographyRecipeProps,
} from "./lib/typography.ts"
export { cn } from "./lib/utils.ts"
