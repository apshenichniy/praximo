import { useEffect, useState } from "react"

import { AvatarProcessingError, normalizeAvatarFile } from "@/features/admin/avatar-normalizer.ts"

export type AvatarIntent = "keep" | "replace" | "reset"

const processingErrorMessage = (error: unknown): string =>
  error instanceof AvatarProcessingError && error.reason === "size"
    ? "Choose an image up to 10 MB."
    : error instanceof AvatarProcessingError && error.reason === "type"
      ? "Choose a JPEG, PNG, or WebP image."
      : "This image could not be processed."

export interface AvatarPicker {
  readonly file: File | undefined
  readonly previewUrl: string | undefined
  readonly intent: AvatarIntent
  /** True once the admin interacted with the picker at all (create-flow dirty flag). */
  readonly touched: boolean
  readonly processing: boolean
  readonly error: string | undefined
  /** Normalize and stage a newly chosen file. */
  readonly choose: (file: File | undefined) => Promise<void>
  /** Stage removal of the custom avatar (edit flow: back to the Praximo default). */
  readonly reset: () => void
  /** Drop any staged change and return to the current avatar. */
  readonly undo: () => void
}

/**
 * Staged avatar selection shared by the create and edit forms: normalization via
 * `normalizeAvatarFile`, preview object-URL lifecycle, and the keep/replace/reset
 * intent the profile mutation submits.
 */
export const useAvatarPicker = ({ onChange }: { onChange?: () => void } = {}): AvatarPicker => {
  const [file, setFile] = useState<File>()
  const [previewUrl, setPreviewUrl] = useState<string>()
  const [intent, setIntent] = useState<AvatarIntent>("keep")
  const [touched, setTouched] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string>()

  // Revoke each preview URL when it is replaced or the component unmounts.
  useEffect(
    () => () => {
      if (previewUrl !== undefined) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl],
  )

  const choose = async (chosen: File | undefined) => {
    if (chosen === undefined) return
    setTouched(true)
    setError(undefined)
    setProcessing(true)
    onChange?.()
    try {
      const normalized = await normalizeAvatarFile(chosen)
      setFile(normalized.file)
      setPreviewUrl(URL.createObjectURL(normalized.file))
      setIntent("replace")
    } catch (cause) {
      setFile(undefined)
      setPreviewUrl(undefined)
      setIntent("keep")
      setError(processingErrorMessage(cause))
    } finally {
      setProcessing(false)
    }
  }

  const reset = () => {
    setFile(undefined)
    setPreviewUrl(undefined)
    setIntent("reset")
    setTouched(true)
    setError(undefined)
    onChange?.()
  }

  const undo = () => {
    setFile(undefined)
    setPreviewUrl(undefined)
    setIntent("keep")
    setTouched(true)
    setError(undefined)
  }

  return { file, previewUrl, intent, touched, processing, error, choose, reset, undo }
}
