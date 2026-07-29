import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Heading, Text } from "@praximo/ui"

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
 * Two type layers meet here, and the boundary between them is the point (#223).
 * The page header is interface chrome and keeps the shared semantic roles. The
 * document itself is a reading column: `.typeset` owns the flow between its
 * blocks, so nothing below hand-spaces itself, and a heading inside the running
 * text takes its rhythm from the prose rather than from an interface role.
 */
function Inline({ value }: { readonly value: LegalInline }) {
  if (typeof value === "string") return value
  if ("emphasis" in value) return <strong className="text-foreground">{value.emphasis}</strong>
  if ("link" in value) {
    return (
      // Colour only. The underline and its offset come from the prose layer, so
      // a link reads the same here as in any other block it ends up inside.
      <Link to={value.to} className="text-primary">
        {value.link}
      </Link>
    )
  }
  // Left visible on purpose. These wait on the legal-entity decision, and a
  // silently blank contract clause is worse than one that says it is unfinished.
  return (
    // The edge, not only the fill: a marker that says a clause is unfinished
    // has to read as a marked region on either shared theme. Typeset styles
    // `mark` as a highlight; the border and the primary tint are what make this
    // one read as a note to us instead.
    <mark className="bg-primary/10 text-primary border-primary/30 rounded border px-1 py-0.5 whitespace-nowrap">
      [{legalPlaceholders[value.placeholder]}]
    </mark>
  )
}

const inlines = (content: ReadonlyArray<LegalInline>): ReactNode =>
  content.map((value, index) => <Inline key={index} value={value} />)

function Block({ block }: { readonly block: LegalBlock }) {
  if (block.kind === "paragraph") {
    return <p>{inlines(block.content)}</p>
  }
  if (block.kind === "list") {
    return (
      <ul>
        {block.items.map((item, index) => (
          <li key={index}>{inlines(item)}</li>
        ))}
      </ul>
    )
  }
  // A processor table is wider than the reading measure in every language.
  // `typeset-scroll` lets it scroll at its natural width instead of squeezing
  // Ukrainian and Russian cells into two-character columns.
  return (
    <div className="typeset-scroll">
      <table>
        <thead>
          <tr className="text-foreground">
            {block.head.map((cell) => (
              <th key={cell}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>
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
      <div className="typeset typeset-document text-muted-foreground mt-6">
        {document.intro.map((block, index) => (
          <Block key={index} block={block} />
        ))}
        {document.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.blocks.map((block, index) => (
              <Block key={index} block={block} />
            ))}
          </section>
        ))}
      </div>
    </main>
  )
}
