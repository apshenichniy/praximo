import { WorkspaceNameMaxLength } from "@praximo/domain"

export const requiredName = (value: string): string | undefined => {
  const normalized = value.trim()
  if (normalized.length === 0) return "Workspace name is required"
  if (normalized.length > WorkspaceNameMaxLength) {
    return `Use ${WorkspaceNameMaxLength} characters or fewer`
  }
  return undefined
}
