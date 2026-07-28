import { cva, type VariantProps } from "class-variance-authority"

export const interfaceTypographyRoles = [
  "display",
  "page-title",
  "section-title",
  "card-title",
  "body",
  "body-small",
  "label",
  "caption",
] as const

export type InterfaceTypographyRole = (typeof interfaceTypographyRoles)[number]

export const typographyRecipe = cva("", {
  variants: {
    role: {
      display: "text-5xl font-semibold leading-none tracking-tight sm:text-6xl",
      "page-title": "text-3xl font-semibold leading-tight tracking-tight sm:text-4xl",
      "section-title": "text-xl font-semibold leading-tight tracking-tight",
      "card-title": "text-base font-semibold leading-snug tracking-tight",
      body: "text-base font-normal leading-relaxed",
      "body-small": "text-sm font-normal leading-relaxed",
      label: "text-sm font-medium leading-none",
      caption: "text-xs font-medium leading-normal tracking-wide",
    },
    mono: {
      true: "font-mono",
      false: "font-sans",
    },
  },
  defaultVariants: {
    role: "body",
    mono: false,
  },
})

export type TypographyRecipeProps = VariantProps<typeof typographyRecipe>
