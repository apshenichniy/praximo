import { createHmac } from "node:crypto"
import { notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import {
  createAdminWorkspace,
  deleteAdminWorkspace,
  getAdminWorkspace,
  listAdminWorkspaces,
  prepareAdminInviteShareMessage,
  recordAdminInviteShare,
  reissueAdminWorkspaceInvite as reissueAdminWorkspaceInviteRuntime,
  renameAdminWorkspace as renameAdminWorkspaceRuntime,
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

export type CreateInviteTransportError = "validation" | "conflict" | "server"

export type CreateInviteTransportResult =
  | { readonly ok: true; readonly value: AdminSurface.CreateResult }
  | { readonly ok: false; readonly error: CreateInviteTransportError }

const validateCreateInvite = (
  input: unknown,
): { readonly initData: string; readonly input: unknown; readonly delivery: unknown } => {
  const validated = validateInitData(input)
  if (
    typeof input !== "object" ||
    input === null ||
    !("input" in input) ||
    !("delivery" in input)
  ) {
    throw notFound()
  }
  return { ...validated, input: input.input, delivery: input.delivery }
}

export const createAdminCoachInvite = createServerFn({ method: "POST" })
  .validator(validateCreateInvite)
  .handler(async ({ data }): Promise<CreateInviteTransportResult> => {
    try {
      return {
        ok: true,
        value: await createAdminWorkspace(data.initData, data.input, data.delivery),
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
        default:
          return { ok: false, error: "server" }
      }
    }
  })

export type PrepareShareTransportError = "validation" | "retryable" | "server"

export type PrepareShareTransportResult =
  | { readonly ok: true; readonly value: AdminSurface.PrepareShareResult }
  | { readonly ok: false; readonly error: PrepareShareTransportError }

const validatePrepareShare = (
  input: unknown,
): { readonly initData: string; readonly inviteId: string; readonly language: string } => {
  const validated = validateInitData(input)
  if (
    typeof input !== "object" ||
    input === null ||
    !("inviteId" in input) ||
    typeof input.inviteId !== "string" ||
    !("language" in input) ||
    typeof input.language !== "string"
  ) {
    throw notFound()
  }
  return { ...validated, inviteId: input.inviteId, language: input.language }
}

export const prepareAdminCoachInviteShare = createServerFn({ method: "POST" })
  .validator(validatePrepareShare)
  .handler(async ({ data }): Promise<PrepareShareTransportResult> => {
    try {
      return {
        ok: true,
        value: await prepareAdminInviteShareMessage(data.initData, data.inviteId, data.language),
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
        case "AdminSurface.SharePreparationFailed":
          return { ok: false, error: "retryable" }
        default:
          return { ok: false, error: "server" }
      }
    }
  })

export type RecordShareTransportResult = { readonly ok: boolean }

/**
 * Post-share bookkeeping: the Mini App calls this once the chat picker confirms
 * a send (or the pre-8.0 fallback opens). It is best-effort — the invite is
 * already out — so failures resolve to `{ ok: false }` for the client to ignore
 * rather than surfacing as an error.
 */
export const recordAdminCoachInviteShare = createServerFn({ method: "POST" })
  .validator(validatePrepareShare)
  .handler(async ({ data }): Promise<RecordShareTransportResult> => {
    try {
      await recordAdminInviteShare(data.initData, data.inviteId, data.language)
      return { ok: true }
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

export type RenameTransportError = "validation" | "conflict" | "server"

export type RenameTransportResult =
  | { readonly ok: true; readonly value: AdminSurface.WorkspaceDetail }
  | { readonly ok: false; readonly error: RenameTransportError }

const validateRename = (
  input: unknown,
): { readonly initData: string; readonly workspaceId: string; readonly input: unknown } => {
  const validated = validateWorkspaceRequest(input)
  if (typeof input !== "object" || input === null || !("input" in input)) throw notFound()
  return { ...validated, input: input.input }
}

/** The internal label is the only workspace field an admin still writes (#108). */
export const renameAdminWorkspace = createServerFn({ method: "POST" })
  .validator(validateRename)
  .handler(async ({ data }): Promise<RenameTransportResult> => {
    try {
      return {
        ok: true,
        value: await renameAdminWorkspaceRuntime(data.initData, data.workspaceId, data.input),
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
        case "AdminSurface.RenameConflict":
          return { ok: false, error: "conflict" }
        default:
          return { ok: false, error: "server" }
      }
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
  .handler(async ({ data }): Promise<CreateInviteTransportResult> => {
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

export type DeleteWorkspaceTransportError =
  | "validation"
  | "confirmation"
  | "conflict"
  | "retryable"
  | "blocked"
  | "server"

export type DeleteWorkspaceTransportResult =
  | { readonly ok: true; readonly value: AdminSurface.DeleteResult }
  | { readonly ok: false; readonly error: DeleteWorkspaceTransportError }

const validateDeleteWorkspace = (
  input: unknown,
): {
  readonly initData: string
  readonly workspaceId: string
  readonly requestId: string
  readonly confirmationName: string
} => {
  const validated = validateWorkspaceRequest(input)
  if (
    typeof input !== "object" ||
    input === null ||
    !("requestId" in input) ||
    typeof input.requestId !== "string" ||
    !("confirmationName" in input) ||
    typeof input.confirmationName !== "string"
  ) {
    throw notFound()
  }
  return {
    ...validated,
    requestId: input.requestId,
    confirmationName: input.confirmationName,
  }
}

export const deleteAdminWorkspaceRequest = createServerFn({ method: "POST" })
  .validator(validateDeleteWorkspace)
  .handler(async ({ data }): Promise<DeleteWorkspaceTransportResult> => {
    try {
      return {
        ok: true,
        value: await deleteAdminWorkspace(data.initData, data.workspaceId, {
          requestId: data.requestId,
          confirmationName: data.confirmationName,
        }),
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
        case "AdminSurface.DeleteConfirmationMismatch":
          return { ok: false, error: "confirmation" }
        case "AdminSurface.DeletionConflict":
          return { ok: false, error: "conflict" }
        case "AdminSurface.DeletionRetryable":
          return { ok: false, error: "retryable" }
        case "AdminSurface.DeletionFailed":
          return { ok: false, error: "blocked" }
        default:
          return { ok: false, error: "server" }
      }
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
