import { WorkspaceNameMaxLength } from "@praximo/domain"

export const requiredName = (value: string): string | undefined => {
  const normalized = value.trim()
  if (normalized.length === 0) return "Workspace name is required"
  if (normalized.length > WorkspaceNameMaxLength) {
    return `Use ${WorkspaceNameMaxLength} characters or fewer`
  }
  return undefined
}

export const requiredLanguage = (value: string): string | undefined =>
  value === "en" || value === "uk" || value === "ru" ? undefined : "Choose the coach language"

export const optionalLimit =
  (limit: number) =>
  (value: string): string | undefined =>
    value.trim().length > limit ? `Use ${limit} characters or fewer` : undefined

export const fieldError = (errors: ReadonlyArray<unknown>): string | undefined => {
  const first = errors[0]
  return typeof first === "string" ? first : undefined
}

/** After a failed submit: bring the first invalid control into view and focus it. */
export const focusFirstInvalidField = (): void => {
  const invalid = document.querySelector<HTMLElement>("[aria-invalid='true']")
  if (invalid === null) return
  invalid.scrollIntoView({ behavior: "smooth", block: "center" })
  invalid.focus({ preventScroll: true })
}
