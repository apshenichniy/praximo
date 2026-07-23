import { createHmac } from "node:crypto"
import { notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import {
  createAdminWorkspace,
  listAdminWorkspaces,
  resendAdminWorkspaceInvite as resendAdminWorkspaceInviteRuntime,
} from "./runtime.server.ts"
import type { AdminSurface } from "./admin-surface.ts"

const validateInitData = (input: unknown): { readonly initData: string } => {
  if (
    typeof input !== "object" ||
    input === null ||
    !("initData" in input) ||
    typeof input.initData !== "string" ||
    input.initData.length === 0
  ) {
    throw notFound()
  }

  return { initData: input.initData }
}

export const loadAdminWorkspaces = createServerFn({ method: "POST" })
  .validator(validateInitData)
  .handler(async ({ data }) => {
    try {
      return await listAdminWorkspaces(data.initData)
    } catch {
      throw notFound()
    }
  })

export type CreateWorkspaceTransportError =
  | "validation"
  | "conflict"
  | "avatar"
  | "upload"
  | "server"

export type CreateWorkspaceTransportResult =
  | { readonly ok: true; readonly value: AdminSurface.CreateResult }
  | { readonly ok: false; readonly error: CreateWorkspaceTransportError }

const validateCreateFormData = (input: unknown): FormData => {
  if (!(input instanceof FormData)) throw notFound()
  return input
}

const MaxAvatarBytes = 10 * 1_024 * 1_024

export const createAdminWorkspaceFromForm = createServerFn({ method: "POST" })
  .validator(validateCreateFormData)
  .handler(async ({ data }): Promise<CreateWorkspaceTransportResult> => {
    const initData = data.get("initData")
    const rawInput = data.get("input")
    const avatar = data.get("avatar")
    if (typeof initData !== "string" || typeof rawInput !== "string") {
      return { ok: false, error: "validation" }
    }
    if (avatar !== null && !(avatar instanceof File)) {
      return { ok: false, error: "validation" }
    }
    if (avatar instanceof File && avatar.size > MaxAvatarBytes) {
      return { ok: false, error: "avatar" }
    }

    let input: unknown
    try {
      input = JSON.parse(rawInput)
    } catch {
      return { ok: false, error: "validation" }
    }

    try {
      const avatarBytes =
        avatar instanceof File && avatar.size > 0
          ? new Uint8Array(await avatar.arrayBuffer())
          : undefined
      return {
        ok: true,
        value: await createAdminWorkspace(initData, input, avatarBytes),
      }
    } catch (error) {
      if (typeof error !== "object" || error === null || !("_tag" in error)) {
        return { ok: false, error: "server" }
      }
      switch (error._tag) {
        case "AdminSurface.AccessDenied":
          throw notFound()
        case "AdminSurface.ValidationFailed":
          return { ok: false, error: "validation" }
        case "AdminSurface.IdempotencyConflict":
          return { ok: false, error: "conflict" }
        case "WorkspaceBrandingStorage.InvalidAvatar":
          return { ok: false, error: "avatar" }
        case "WorkspaceBrandingStorage.UploadFailed":
          return { ok: false, error: "upload" }
        default:
          return { ok: false, error: "server" }
      }
    }
  })

const validateResend = (
  input: unknown,
): { readonly initData: string; readonly inviteId: string } => {
  if (
    typeof input !== "object" ||
    input === null ||
    !("initData" in input) ||
    typeof input.initData !== "string" ||
    !("inviteId" in input) ||
    typeof input.inviteId !== "string"
  ) {
    throw notFound()
  }
  return { initData: input.initData, inviteId: input.inviteId }
}

export const resendAdminWorkspaceInvite = createServerFn({ method: "POST" })
  .validator(validateResend)
  .handler(async ({ data }): Promise<CreateWorkspaceTransportResult> => {
    try {
      return {
        ok: true,
        value: await resendAdminWorkspaceInviteRuntime(data.initData, data.inviteId),
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "_tag" in error &&
        error._tag === "AdminSurface.AccessDenied"
      ) {
        throw notFound()
      }
      return { ok: false, error: "server" }
    }
  })

const signDevelopmentInitData = (token: string, telegramId: string, authDate: number): string => {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "praximo-local-development",
    user: JSON.stringify({
      id: Number(telegramId),
      first_name: "Local",
      last_name: "Admin",
    }),
  })
  params.sort()

  const dataCheckString = [...params.entries()].map(([key, value]) => `${key}=${value}`).join("\n")
  const secretKey = createHmac("sha256", "WebAppData").update(token).digest()
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex")
  params.set("hash", hash)

  return params.toString()
}

/**
 * Local Vite only: produce a short-lived credential so the real auth and DB
 * gate run without exposing the manager token to client JavaScript.
 */
export const loadDevelopmentAdminInitData = createServerFn({
  method: "POST",
}).handler(() => {
  if (!import.meta.env.DEV) throw notFound()

  const token = process.env.MANAGER_BOT_TOKEN
  const telegramId = process.env.ADMIN_TELEGRAM_IDS?.split(",")[0]?.trim()
  if (
    !token ||
    !telegramId ||
    !/^[1-9]\d*$/.test(telegramId) ||
    !Number.isSafeInteger(Number(telegramId))
  ) {
    throw notFound()
  }

  return signDevelopmentInitData(token, telegramId, Math.floor(Date.now() / 1_000))
})
