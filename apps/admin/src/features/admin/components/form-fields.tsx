import type { ReactNode } from "react"
import { useId } from "react"

import { Field, FieldError, FieldLabel } from "@praximo/ui/components/field"
import { Input } from "@praximo/ui/components/input"

interface CommonFieldProps {
  readonly label: ReactNode
  readonly name: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onBlur: () => void
  readonly error: string | undefined
  readonly maxLength: number
  /** Displayed character budget, e.g. 512 → "37/512". */
  readonly counter?: number
  readonly placeholder?: string
  readonly disabled?: boolean
  /**
   * Left alone for ordinary text. `email` is what puts the "@" key on a phone
   * keyboard — the browser's own validation stays off, since the field reports
   * its own errors.
   */
  readonly type?: "text" | "email"
  readonly autoComplete?: string
}

function FieldHeading({
  htmlFor,
  label,
  value,
  counter,
}: {
  readonly htmlFor: string
  readonly label: ReactNode
  readonly value: string
  readonly counter: number | undefined
}) {
  return (
    <div className="flex items-center justify-between">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {counter === undefined ? null : (
        <span className="text-muted-foreground text-base leading-relaxed font-normal">
          {value.length}/{counter}
        </span>
      )}
    </div>
  )
}

export function TextField({
  label,
  name,
  value,
  onChange,
  onBlur,
  error,
  maxLength,
  counter,
  placeholder,
  disabled,
  type,
  autoComplete,
}: CommonFieldProps) {
  const id = useId()
  return (
    <Field data-invalid={error === undefined ? undefined : true}>
      <FieldHeading htmlFor={id} label={label} value={value} counter={counter} />
      <Input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 rounded-2xl px-4 text-base leading-snug"
      />
      {error === undefined ? null : <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  )
}
