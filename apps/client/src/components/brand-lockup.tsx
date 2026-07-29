import { PraximoMark } from "@praximo/ui"

/**
 * Whose page this is, said once and the same way everywhere in this app.
 *
 * It existed twice with two different sizes — 28px in the acceptance page's
 * header and 20px in the legal footer — which made the same brand look like two
 * brands depending on which route a client landed on. A client meets this app
 * once, often on exactly two pages in a row (accept, then the privacy policy),
 * and the mark is the only thing on either that says they are still in the same
 * place.
 *
 * The larger casting wins. 20px was sized for a footer's caption row, and at
 * that size the mark's guiding point — the one detail that makes it the Praximo
 * mark rather than a violet blob — is below the threshold where it survives on
 * a dark ground.
 */
export function BrandLockup() {
  return (
    <span className="flex items-center gap-2.5">
      <PraximoMark size={28} />
      <b className="text-base font-[620] tracking-[-0.02em]">Praximo</b>
    </span>
  )
}
