import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import {
  type LegalBlock,
  type LegalDocument,
  type LegalInline,
  type LegalLocale,
  legalPlaceholders,
} from "@/features/legal/content.ts"

/**
 * One renderer for both legal texts, in whatever locale it is handed. Only `en`
 * is authored today; the parameter exists so the i18n foundation ticket adds
 * translations rather than re-authoring shipped legal markup.
 *
 * Public: these routes take no credential. A coach reads them from inside the
 * terms screen, a client will read the policy from the consent page, and
 * neither is signed in at that moment.
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
    <mark className="bg-primary/15 text-primary rounded px-1 py-0.5 text-[13px] whitespace-nowrap">
      [{legalPlaceholders[value.placeholder]}]
    </mark>
  )
}

const inlines = (content: ReadonlyArray<LegalInline>): ReactNode =>
  content.map((value, index) => <Inline key={index} value={value} />)

function Block({ block }: { readonly block: LegalBlock }) {
  if (block.kind === "paragraph") {
    return (
      <p className="text-muted-foreground mt-3 text-[15px] leading-6">{inlines(block.content)}</p>
    )
  }
  if (block.kind === "list") {
    return (
      <ul className="text-muted-foreground mt-3 list-disc space-y-2 pl-5 text-[15px] leading-6">
        {block.items.map((item, index) => (
          <li key={index}>{inlines(item)}</li>
        ))}
      </ul>
    )
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[13px]">
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
  /** Reserved for the i18n foundation ticket; only `en` is authored (D4). */
  readonly locale: LegalLocale
}) {
  return (
    <main lang={locale} className="mx-auto w-full max-w-2xl px-5 pt-10 pb-16">
      <h1 className="text-2xl font-semibold tracking-tight text-pretty">{document.title}</h1>
      <p className="text-muted-foreground mt-2 font-mono text-xs">{version}</p>
      {document.intro.map((block, index) => (
        <Block key={index} block={block} />
      ))}
      {document.sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="text-base font-semibold tracking-tight">{section.heading}</h2>
          {section.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </section>
      ))}
    </main>
  )
}
