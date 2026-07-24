import { WorkspaceNameMaxLength } from "@praximo/domain"

/**
 * Deliberately permissive: the client's job is to catch the typo the manager
 * can still fix while the sheet is open — a missing `@`, a bare domain, a
 * trailing space — not to adjudicate RFC 5322. Anything past that shape is the
 * sender's business, and only a delivery attempt can settle it.
 */
const emailShape = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export const inviteEmail = (value: string): string | undefined => {
  const normalized = value.trim()
  if (normalized.length === 0) return "Email is required"
  if (!emailShape.test(normalized)) return "Enter a valid email address"
  return undefined
}

export const requiredName = (value: string): string | undefined => {
  const normalized = value.trim()
  if (normalized.length === 0) return "Workspace name is required"
  if (normalized.length > WorkspaceNameMaxLength) {
    return `Use ${WorkspaceNameMaxLength} characters or fewer`
  }
  return undefined
}
