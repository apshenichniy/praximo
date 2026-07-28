import type { BotIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReactNode } from "react"

import { Heading, Text, cn } from "@praximo/ui"

/**
 * The shape every entry screen keeps, loading frame included (#106): one mark,
 * one sentence about where the viewer stands, and at most one thing to do about
 * it. Vertically centred, because these carry a message rather than a surface —
 * anchoring them to the top would leave the phone half empty.
 *
 * Shared so the frame painted *before* the gate answers and the ones painted
 * after it are the same frame: the mark must not move when the role lands.
 */
export const entryFrameClass =
  "mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-5 py-14"

/** The brand mark, or a muted one — a failure is not a state to badge. */
export const entryMarkClass = (tone: "brand" | "muted"): string =>
  cn(
    "flex size-20 items-center justify-center rounded-full ring-1",
    tone === "brand"
      ? "bg-primary text-primary-foreground shadow-primary/20 ring-primary/25 shadow-2xl"
      : "bg-card ring-border text-muted-foreground",
  )

export function EntryFrame({
  icon,
  title,
  body,
  tone = "brand",
  children,
}: {
  readonly icon: typeof BotIcon
  readonly title: string
  readonly body: string
  readonly tone?: "brand" | "muted"
  readonly children?: ReactNode
}) {
  return (
    <main className={entryFrameClass}>
      <header className="flex flex-col items-center text-center">
        <span aria-hidden="true" className={entryMarkClass(tone)}>
          <HugeiconsIcon icon={icon} size={34} strokeWidth={1.6} />
        </span>
        <Heading as="h1" role="display" className="mt-7 text-pretty">
          {title}
        </Heading>
        <Text className="text-muted-foreground mt-3 text-pretty">{body}</Text>
      </header>
      {children}
    </main>
  )
}
