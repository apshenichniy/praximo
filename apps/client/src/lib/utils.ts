import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The six steps of this app's type scale, named for the job rather than the
 * size — see `styles/app.css` §Type scale (#186, narrowed in #198).
 *
 * They have to be stated here as well because `--text-*: initial` switches
 * Tailwind's own scale off, and tailwind-merge recognises a font size only by
 * name, from the built-in list this app just discarded. A name it does not know
 * falls through to the colour group, so `text-emphasis` and `text-background`
 * looked to it like two colours and it kept only the later one — silently
 * deleting the colour from every filled control that also set its size.
 */
const TYPE_SCALE = ["caption", "body", "emphasis", "heading", "title", "display"] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TYPE_SCALE] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
