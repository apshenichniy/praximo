const AcceptedAvatarTypes = new Set(["image/jpeg", "image/png", "image/webp"])
const MaxAvatarBytes = 10 * 1_024 * 1_024
const AvatarSide = 512

export type AvatarProcessingFailure = "type" | "size" | "decode"

export class AvatarProcessingError extends Error {
  readonly reason: AvatarProcessingFailure

  constructor(reason: AvatarProcessingFailure) {
    super(reason)
    this.name = "AvatarProcessingError"
    this.reason = reason
  }
}

export const validateAvatarFile = (file: File): void => {
  if (!AcceptedAvatarTypes.has(file.type)) throw new AvatarProcessingError("type")
  if (file.size === 0 || file.size > MaxAvatarBytes) throw new AvatarProcessingError("size")
}

export interface NormalizedBlob {
  readonly blob: Blob
  readonly width: number
  readonly height: number
}

export interface NormalizedAvatar {
  readonly file: File
  readonly width: number
  readonly height: number
}

type NormalizeImage = (file: File) => Promise<NormalizedBlob>

const normalizeInBrowser: NormalizeImage = async (file) => {
  try {
    const image = await createImageBitmap(file)
    const canvas = document.createElement("canvas")
    canvas.width = AvatarSide
    canvas.height = AvatarSide
    const context = canvas.getContext("2d")
    if (context === null) throw new AvatarProcessingError("decode")

    const sourceSide = Math.min(image.width, image.height)
    const sourceX = (image.width - sourceSide) / 2
    const sourceY = (image.height - sourceSide) / 2
    context.drawImage(image, sourceX, sourceY, sourceSide, sourceSide, 0, 0, AvatarSide, AvatarSide)
    image.close()

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result === null ? reject(new AvatarProcessingError("decode")) : resolve(result),
        "image/jpeg",
        0.9,
      )
    })
    return { blob, width: AvatarSide, height: AvatarSide }
  } catch (error) {
    if (error instanceof AvatarProcessingError) throw error
    throw new AvatarProcessingError("decode")
  }
}

export const normalizeAvatarFile = async (
  file: File,
  normalize: NormalizeImage = normalizeInBrowser,
): Promise<NormalizedAvatar> => {
  validateAvatarFile(file)
  const normalized = await normalize(file)
  if (
    normalized.blob.type !== "image/jpeg" ||
    normalized.width !== AvatarSide ||
    normalized.height !== AvatarSide
  ) {
    throw new AvatarProcessingError("decode")
  }
  return {
    file: new File([normalized.blob], "avatar.jpg", { type: "image/jpeg" }),
    width: normalized.width,
    height: normalized.height,
  }
}
