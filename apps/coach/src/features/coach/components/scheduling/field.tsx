export function Field({
  label,
  trailing,
  children,
}: {
  readonly label: string
  /** Something the field says about itself, on the label's own line. */
  readonly trailing?: React.ReactNode
  readonly children: React.ReactNode
}) {
  return (
    <div className="mt-5 flex flex-col gap-2 first:mt-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-muted-foreground text-xs leading-normal font-semibold tracking-wide uppercase">
          {label}
        </p>
        {trailing}
      </div>
      {children}
    </div>
  )
}
