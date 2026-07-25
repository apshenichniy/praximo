import { execFile, spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import sharp from "sharp"
import { requireEnv } from "./env.ts"

const execFileAsync = promisify(execFile)

export const parseBrandingAvatarArgs = (
  args: ReadonlyArray<string>,
): { readonly stage: string; readonly file: string; readonly key: string } => {
  const stageIndex = args.indexOf("--stage")
  const fileIndex = args.indexOf("--file")
  const keyIndex = args.indexOf("--key")
  const stage = stageIndex < 0 ? undefined : args[stageIndex + 1]
  const file = fileIndex < 0 ? undefined : args[fileIndex + 1]
  const key = keyIndex < 0 ? undefined : args[keyIndex + 1]
  if (stage === undefined || !/^(?:dev_[a-z0-9_-]+|prod)$/.test(stage)) {
    throw new Error("expected --stage dev_<name> or --stage prod")
  }
  if (file === undefined || file.length === 0) throw new Error("expected --file <image>")
  if (
    key === undefined ||
    key.length === 0 ||
    key.startsWith("/") ||
    key.endsWith("/") ||
    key.includes("..")
  ) {
    throw new Error("expected --key <configured-r2-object-key>")
  }
  return { stage, file: resolve(file), key }
}

export const selectStageBucket = (stage: string, names: ReadonlyArray<string>): string => {
  const stageSlug = stage.replaceAll("_", "-")
  const matches = names.filter((name) => {
    const normalized = name.toLowerCase()
    return (
      normalized.includes("praximo") &&
      normalized.includes(stageSlug) &&
      normalized.includes("uploads")
    )
  })
  if (matches.length !== 1) {
    throw new Error(`expected exactly one Uploads bucket for ${stage}; found ${matches.length}`)
  }
  const bucket = matches[0]
  if (bucket === undefined) throw new Error("stage bucket disappeared")
  return bucket
}

const main = async () => {
  const { stage, file, key: objectKey } = parseBrandingAvatarArgs(process.argv.slice(2))
  requireEnv("CLOUDFLARE_ACCOUNT_ID")
  requireEnv("CLOUDFLARE_API_TOKEN")
  const configuredObjectKey = requireEnv("DEFAULT_COACH_BOT_AVATAR_R2_KEY")
  if (objectKey !== configuredObjectKey) {
    throw new Error("--key does not match the configured DEFAULT_COACH_BOT_AVATAR_R2_KEY")
  }

  const metadata = await sharp(file).metadata()
  if (metadata.format === undefined || !["jpeg", "png", "webp", "svg"].includes(metadata.format)) {
    throw new Error("avatar must be JPEG, PNG, WebP, or SVG")
  }

  const directory = await mkdtemp(join(tmpdir(), "praximo-branding-avatar-"))
  const normalizedFile = join(directory, "avatar.jpg")
  try {
    await sharp(file)
      .resize(512, 512, { fit: "cover", position: "centre" })
      .jpeg({ quality: 90 })
      .toFile(normalizedFile)

    const { stdout } = await execFileAsync(
      "bunx",
      ["wrangler", "r2", "bucket", "list", "--jurisdiction", "eu"],
      { env: process.env },
    )
    const names = stdout
      .split("\n")
      .flatMap((line) => (line.startsWith("name:") ? [line.slice("name:".length).trim()] : []))
    const bucket = selectStageBucket(stage, names)
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      const child = spawn(
        "bunx",
        [
          "wrangler",
          "r2",
          "object",
          "put",
          `${bucket}/${objectKey}`,
          "--file",
          normalizedFile,
          "--content-type",
          "image/jpeg",
          "--jurisdiction",
          "eu",
          "--remote",
          "--force",
        ],
        { stdio: "inherit", env: process.env },
      )
      child.once("error", reject)
      child.once("close", resolveExit)
    })
    if (exitCode !== 0) throw new Error("wrangler failed to replace the branding avatar")
    console.log(`Replaced the ${stage} default coach-bot avatar at the configured R2 key.`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  await main()
}
