import type { ReactNode } from "react"
import { useId } from "react"

import { Field, FieldError, FieldLabel } from "@/components/ui/field.tsx"
import { Input } from "@/components/ui/input.tsx"
import { Textarea } from "@/components/ui/textarea.tsx"

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
        <span className="text-muted-foreground text-sm font-normal">
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
}: CommonFieldProps) {
  const id = useId()
  return (
    <Field data-invalid={error === undefined ? undefined : true}>
      <FieldHeading htmlFor={id} label={label} value={value} counter={counter} />
      <Input
        id={id}
        name={name}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 rounded-2xl px-4 text-base"
      />
      {error === undefined ? null : <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  )
}

export function TextareaField({
  label,
  name,
  value,
  onChange,
  onBlur,
  error,
  maxLength,
  counter,
  placeholder,
  rows,
}: CommonFieldProps & { readonly rows: number }) {
  const id = useId()
  return (
    <Field data-invalid={error === undefined ? undefined : true}>
      <FieldHeading htmlFor={id} label={label} value={value} counter={counter} />
      <Textarea
        id={id}
        name={name}
        value={value}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        className="field-sizing-fixed rounded-2xl px-4 py-3 text-base"
      />
      {error === undefined ? null : <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  )
}

/** Muted "(optional)" suffix for field labels. */
export function OptionalHint() {
  return <span className="text-muted-foreground font-normal">(optional)</span>
}
