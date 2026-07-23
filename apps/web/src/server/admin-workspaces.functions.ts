import { createHmac } from "node:crypto"
import { notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import {
  createAdminWorkspace,
  getAdminWorkspace,
  getAdminWorkspaceAvatar,
  listAdminWorkspaces,
  reissueAdminWorkspaceInvite as reissueAdminWorkspaceInviteRuntime,
  resendAdminWorkspaceInvite as resendAdminWorkspaceInviteRuntime,
  retryAdminWorkspaceBranding,
  updateAdminWorkspaceProfile,
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

const validateWorkspaceRequest = (
  input: unknown,
): { readonly initData: string; readonly workspaceId: string } => {
  const validated = validateInitData(input)
  if (
    typeof input !== "object" ||
    input === null ||
    !("workspaceId" in input) ||
    typeof input.workspaceId !== "string" ||
    input.workspaceId.length === 0
  ) {
    throw notFound()
  }
  return { ...validated, workspaceId: input.workspaceId }
}

export const loadAdminWorkspace = createServerFn({ method: "POST" })
  .validator(validateWorkspaceRequest)
  .handler(async ({ data }) => {
    try {
      return await getAdminWorkspace(data.initData, data.workspaceId)
    } catch {
      throw notFound()
    }
  })

export type AvatarTransportResult =
  | { readonly ok: true; readonly contentType: string; readonly base64: string }
  | { readonly ok: false }

export const loadAdminWorkspaceAvatar = createServerFn({ method: "POST" })
  .validator(validateWorkspaceRequest)
  .handler(async ({ data }): Promise<AvatarTransportResult> => {
    try {
      const avatar = await getAdminWorkspaceAvatar(data.initData, data.workspaceId)
      return {
        ok: true,
        contentType: avatar.contentType,
        base64: Buffer.from(avatar.bytes).toString("base64"),
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
      return { ok: false }
    }
  })

export type UpdateProfileTransportError = "validation" | "conflict" | "avatar" | "upload" | "server"

export type UpdateProfileTransportResult =
  | { readonly ok: true; readonly value: AdminSurface.UpdateProfileResult }
  | { readonly ok: false; readonly error: UpdateProfileTransportError }

export const updateAdminWorkspaceProfileFromForm = createServerFn({ method: "POST" })
  .validator(validateCreateFormData)
  .handler(async ({ data }): Promise<UpdateProfileTransportResult> => {
    const initData = data.get("initData")
    const workspaceId = data.get("workspaceId")
    const rawInput = data.get("input")
    const avatar = data.get("avatar")
    if (
      typeof initData !== "string" ||
      typeof workspaceId !== "string" ||
      typeof rawInput !== "string" ||
      (avatar !== null && !(avatar instanceof File))
    ) {
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
        value: await updateAdminWorkspaceProfile(initData, workspaceId, input, avatarBytes),
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
        case "AdminSurface.ProfileConflict":
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

const validateBrandingRetry = (
  input: unknown,
): { readonly initData: string; readonly workspaceId: string; readonly retryAvatar: boolean } => {
  const validated = validateWorkspaceRequest(input)
  if (
    typeof input !== "object" ||
    input === null ||
    !("retryAvatar" in input) ||
    typeof input.retryAvatar !== "boolean"
  ) {
    throw notFound()
  }
  return { ...validated, retryAvatar: input.retryAvatar }
}

export const retryAdminWorkspaceProfileBranding = createServerFn({ method: "POST" })
  .validator(validateBrandingRetry)
  .handler(async ({ data }): Promise<UpdateProfileTransportResult> => {
    try {
      return {
        ok: true,
        value: await retryAdminWorkspaceBranding(data.initData, data.workspaceId, data.retryAvatar),
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

const validateReissue = (
  input: unknown,
): {
  readonly initData: string
  readonly workspaceId: string
  readonly expectedInviteId: string
  readonly requestId: string
} => {
  const validated = validateWorkspaceRequest(input)
  if (
    typeof input !== "object" ||
    input === null ||
    !("expectedInviteId" in input) ||
    typeof input.expectedInviteId !== "string" ||
    !("requestId" in input) ||
    typeof input.requestId !== "string"
  ) {
    throw notFound()
  }
  return {
    ...validated,
    expectedInviteId: input.expectedInviteId,
    requestId: input.requestId,
  }
}

export const reissueAdminWorkspaceInvite = createServerFn({ method: "POST" })
  .validator(validateReissue)
  .handler(async ({ data }): Promise<CreateWorkspaceTransportResult> => {
    try {
      return {
        ok: true,
        value: await reissueAdminWorkspaceInviteRuntime(
          data.initData,
          data.workspaceId,
          data.expectedInviteId,
          data.requestId,
        ),
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
