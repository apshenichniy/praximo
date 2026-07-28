import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Heading, Text, cn, typographyRecipe } from "@praximo/ui"

import {
  type LegalBlock,
  type LegalDocument,
  type LegalInline,
  type LegalLocale,
  legalPlaceholders,
} from "@praximo/i18n"

/**
 * One renderer for both legal texts, in whatever locale it is handed. All three
 * are authored (#130), and the renderer never had to change for that — which is
 * what the parameter was reserved for.
 *
 * Public: these routes take no credential. A coach reads them from inside the
 * terms screen, a client will read the policy from the consent page, and
 * neither is signed in at that moment.
 *
 * Long-form content uses the same shared semantic roles as every other surface.
 * The readable measure changes at the layout boundary; type sizes stay owned by
 * the Maia recipes so this page cannot silently fork the interface scale.
 */
function Inline({ value }: { readonly value: LegalInline }) {
  if (typeof value === "string") return value
  if ("emphasis" in value) return <strong className="text-foreground">{value.emphasis}</strong>
  if ("link" in value) {
    return (
      <Link to={value.to} className="text-primary underline underline-offset-4">
        {value.link}
      </Link>
    )
  }
  // Left visible on purpose. These wait on the legal-entity decision, and a
  // silently blank contract clause is worse than one that says it is unfinished.
  return (
    // The edge, not only the fill: a marker that says a clause is unfinished
    // has to read as a marked region on either shared theme.
    <mark
      className={cn(
        typographyRecipe({ role: "caption" }),
        "bg-primary/10 text-primary border-primary/30 rounded border px-1 py-0.5 whitespace-nowrap",
      )}
    >
      [{legalPlaceholders[value.placeholder]}]
    </mark>
  )
}

const inlines = (content: ReadonlyArray<LegalInline>): ReactNode =>
  content.map((value, index) => <Inline key={index} value={value} />)

function Block({ block }: { readonly block: LegalBlock }) {
  if (block.kind === "paragraph") {
    return <Text className="text-muted-foreground mt-3">{inlines(block.content)}</Text>
  }
  if (block.kind === "list") {
    return (
      <ul
        className={cn(
          typographyRecipe({ role: "body" }),
          "text-muted-foreground mt-3 list-disc space-y-2 pl-5",
        )}
      >
        {block.items.map((item, index) => (
          <li key={index}>{inlines(item)}</li>
        ))}
      </ul>
    )
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <table
        className={cn(typographyRecipe({ role: "caption" }), "w-full border-collapse text-left")}
      >
        <thead>
          <tr className="text-foreground">
            {block.head.map((cell) => (
              <th key={cell} className="border-border border-b px-2 py-2 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-muted-foreground">
          {block.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border-border/50 border-b px-2 py-2 align-top">
                  <Inline value={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LegalPage({
  document,
  version,
  locale,
}: {
  readonly document: LegalDocument
  readonly version: string
  /**
   * The language this rendering is in — one of the three, all authored. It is
   * also the `lang` attribute below, so a screen reader switches voice with it.
   */
  readonly locale: LegalLocale
}) {
  return (
    <main lang={locale} className="mx-auto w-full max-w-2xl px-5 pt-10 pb-16 md:pt-16">
      <Heading as="h1" role="page-title" className="text-pretty">
        {document.title}
      </Heading>
      <Text mono role="caption" className="text-muted-foreground mt-2">
        {version}
      </Text>
      {document.intro.map((block, index) => (
        <Block key={index} block={block} />
      ))}
      {document.sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <Heading as="h2" role="section-title">
            {section.heading}
          </Heading>
          {section.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </section>
      ))}
    </main>
  )
}
