/**
 * Where the coach is in first login, in two segments and a line of text.
 *
 * First login is two steps rather than one screen (#130): the coach settles the
 * language Praximo will speak to them, and *then* reads the terms in it. That
 * ordering only helps if the second step is visibly coming — a language chooser
 * with a "Continue" and no horizon reads like a settings page that appeared
 * uninvited.
 */
export function OnboardingProgress({
  step,
  label,
}: {
  readonly step: 1 | 2
  readonly label: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="flex gap-1.5">
        <span className="bg-primary h-1 w-7 rounded-full" />
        <span
          className={
            step === 2 ? "bg-primary h-1 w-7 rounded-full" : "bg-muted h-1 w-7 rounded-full"
          }
        />
      </span>
      <span className="text-muted-foreground text-caption font-medium tracking-wide uppercase">
        {label}
      </span>
    </div>
  )
}
