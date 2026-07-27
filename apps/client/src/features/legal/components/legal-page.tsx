import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

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
 * **Every size here takes a step up past `md`** (#191). The app's type scale was
 * calibrated on a phone, for a Telegram webview, and sits one step below the
 * platform's on purpose — 15px running text where iOS Body is 17. That is right
 * for a coach glancing at a card and wrong for a stranger reading a contract on
 * a desktop, which is the one long-form document this product has. The scale is
 * not changed; the page picks a different step of it at a width where the
 * shorter one stops being a reading measure.
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
    // The edge, not only the fill: on the light page `--brand-surface` is 1.04:1
    // against the ground — a difference of hue with none of luminance — and a
    // marker that says a clause is unfinished has to read as a marked region.
    <mark className="bg-brand-surface text-brand border-brand-border rounded border px-1 py-0.5 text-caption whitespace-nowrap md:text-body">
      [{legalPlaceholders[value.placeholder]}]
    </mark>
  )
}

const inlines = (content: ReadonlyArray<LegalInline>): ReactNode =>
  content.map((value, index) => <Inline key={index} value={value} />)

function Block({ block }: { readonly block: LegalBlock }) {
  if (block.kind === "paragraph") {
    return (
      <p className="text-muted-foreground mt-3 text-body leading-6 md:text-emphasis md:leading-7">
        {inlines(block.content)}
      </p>
    )
  }
  if (block.kind === "list") {
    return (
      <ul className="text-muted-foreground mt-3 list-disc space-y-2 pl-5 text-body leading-6 md:text-emphasis md:leading-7">
        {block.items.map((item, index) => (
          <li key={index}>{inlines(item)}</li>
        ))}
      </ul>
    )
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-caption md:text-body">
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
      <h1 className="text-title font-semibold tracking-tight text-pretty md:text-display">
        {document.title}
      </h1>
      <p className="text-muted-foreground mt-2 font-mono text-caption md:text-body">{version}</p>
      {document.intro.map((block, index) => (
        <Block key={index} block={block} />
      ))}
      {document.sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="text-emphasis font-semibold tracking-tight md:text-heading">
            {section.heading}
          </h2>
          {section.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </section>
      ))}
    </main>
  )
}
