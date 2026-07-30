import { notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import { adminRefusal, notFoundWhenDenied } from "./admin-transport.ts"
import { AdminSurface } from "./admin-surface.ts"
import { type LaunchCredential, launchCredential } from "@/launch-credential.ts"
import { runAdmin } from "./runtime.server.ts"

/**
 * Every admin transport answers a missing credential the way it answers a
 * refused one — with a missing page. The admin tree is not a screen anyone is
 * expected to reach without a credential; the entry gate next door is, and it
 * says so with its own answer rather than a 404.
 */
const requireCredential = (context: { readonly credential: LaunchCredential }): string => {
  if (context.credential.initData.length === 0) throw notFound()
  return context.credential.initData
}

export const loadAdminWorkspaces = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(async ({ context }) => {
    try {
      return await runAdmin(
        Effect.flatMap(AdminSurface.Service, (s) => s.listWorkspaces(requireCredential(context))),
      )
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
): { readonly input: unknown; readonly delivery: unknown } => {
  if (
    typeof input !== "object" ||
    input === null ||
    !("input" in input) ||
    !("delivery" in input)
  ) {
    throw notFound()
  }
  return { input: input.input, delivery: input.delivery }
}

export const createAdminCoachInvite = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(validateCreateInvite)
  .handler(async ({ context, data }): Promise<CreateInviteTransportResult> => {
    try {
      return {
        ok: true,
        value: await runAdmin(
          Effect.flatMap(AdminSurface.Service, (s) =>
            s.createWorkspace(requireCredential(context), data.input, data.delivery),
          ),
        ),
      }
    } catch (error) {
      return {
        ok: false,
        error: adminRefusal(error, {
          "AdminSurface.ValidationFailed": "validation",
          "AdminSurface.IdempotencyConflict": "conflict",
        }),
      }
    }
  })

export type PrepareShareTransportError = "validation" | "retryable" | "server"

export type PrepareShareTransportResult =
  | { readonly ok: true; readonly value: AdminSurface.PrepareShareResult }
  | { readonly ok: false; readonly error: PrepareShareTransportError }

const validatePrepareShare = (
  input: unknown,
): { readonly inviteId: string; readonly language: string } => {
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
  return { inviteId: input.inviteId, language: input.language }
}

export const prepareAdminCoachInviteShare = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(validatePrepareShare)
  .handler(async ({ context, data }): Promise<PrepareShareTransportResult> => {
    try {
      return {
        ok: true,
        value: await runAdmin(
          Effect.flatMap(AdminSurface.Service, (s) =>
            s.prepareInviteShareMessage(requireCredential(context), data.inviteId, data.language),
          ),
        ),
      }
    } catch (error) {
      return {
        ok: false,
        error: adminRefusal(error, {
          "AdminSurface.ValidationFailed": "validation",
          "AdminSurface.SharePreparationFailed": "retryable",
        }),
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
  .middleware([launchCredential])
  .validator(validatePrepareShare)
  .handler(async ({ context, data }): Promise<RecordShareTransportResult> => {
    try {
      await runAdmin(
        Effect.flatMap(AdminSurface.Service, (s) =>
          s.recordInviteShare(requireCredential(context), data.inviteId, data.language),
        ),
      )
      return { ok: true }
    } catch (error) {
      // The missing page still has to happen; which refusal it was does not. The
      // invite has already gone out, and the screen cannot act on the difference.
      notFoundWhenDenied(error)
      return { ok: false }
    }
  })

const validateWorkspaceRequest = (input: unknown): { readonly workspaceId: string } => {
  if (
    typeof input !== "object" ||
    input === null ||
    !("workspaceId" in input) ||
    typeof input.workspaceId !== "string" ||
    input.workspaceId.length === 0
  ) {
    throw notFound()
  }
  return { workspaceId: input.workspaceId }
}

export const loadAdminWorkspace = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(validateWorkspaceRequest)
  .handler(async ({ context, data }) => {
    try {
      return await runAdmin(
        Effect.flatMap(AdminSurface.Service, (s) =>
          s.getWorkspace(requireCredential(context), data.workspaceId),
        ),
      )
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
): { readonly workspaceId: string; readonly input: unknown } => {
  const validated = validateWorkspaceRequest(input)
  if (typeof input !== "object" || input === null || !("input" in input)) throw notFound()
  return { ...validated, input: input.input }
}

/** The internal label is the only workspace field an admin still writes (#108). */
export const renameAdminWorkspace = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(validateRename)
  .handler(async ({ context, data }): Promise<RenameTransportResult> => {
    try {
      return {
        ok: true,
        value: await runAdmin(
          Effect.flatMap(AdminSurface.Service, (s) =>
            s.renameWorkspace(requireCredential(context), data.workspaceId, data.input),
          ),
        ),
      }
    } catch (error) {
      return {
        ok: false,
        error: adminRefusal(error, {
          "AdminSurface.ValidationFailed": "validation",
          "AdminSurface.RenameConflict": "conflict",
        }),
      }
    }
  })

const validateReissue = (
  input: unknown,
): {
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
  .middleware([launchCredential])
  .validator(validateReissue)
  .handler(async ({ context, data }): Promise<CreateInviteTransportResult> => {
    try {
      return {
        ok: true,
        value: await runAdmin(
          Effect.flatMap(AdminSurface.Service, (s) =>
            s.reissueWorkspaceInvite(
              requireCredential(context),
              data.workspaceId,
              data.expectedInviteId,
              data.requestId,
            ),
          ),
        ),
      }
    } catch (error) {
      // Every refusal but the missing page reads the same here: a reissue that
      // did not happen leaves the invitation on file exactly as it was.
      notFoundWhenDenied(error)
      return { ok: false, error: "server" }
    }
  })

export type DeleteWorkspaceTransportError =
  | "validation"
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
  readonly workspaceId: string
  readonly requestId: string
} => {
  const validated = validateWorkspaceRequest(input)
  if (
    typeof input !== "object" ||
    input === null ||
    !("requestId" in input) ||
    typeof input.requestId !== "string"
  ) {
    throw notFound()
  }
  return { ...validated, requestId: input.requestId }
}

export const deleteAdminWorkspaceRequest = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(validateDeleteWorkspace)
  .handler(async ({ context, data }): Promise<DeleteWorkspaceTransportResult> => {
    try {
      return {
        ok: true,
        value: await runAdmin(
          Effect.flatMap(AdminSurface.Service, (s) =>
            s.deleteWorkspace(requireCredential(context), data.workspaceId, {
              requestId: data.requestId,
            }),
          ),
        ),
      }
    } catch (error) {
      return {
        ok: false,
        error: adminRefusal(error, {
          "AdminSurface.ValidationFailed": "validation",
          "AdminSurface.DeletionConflict": "conflict",
          "AdminSurface.DeletionRetryable": "retryable",
          "AdminSurface.DeletionFailed": "blocked",
        }),
      }
    }
  })

/**
 * The progress poll. It keeps answering after the cascade has removed the
 * workspace itself, so a sheet watching the pipeline never loses its subject
 * mid-run. Absence travels as `null` rather than `undefined`: "no deletion has
 * ever been requested" is a cacheable answer, and a query cache cannot hold
 * `undefined` — that is its own word for "nothing fetched yet".
 */
export const loadAdminWorkspaceDeletion = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(validateWorkspaceRequest)
  .handler(async ({ context, data }): Promise<AdminSurface.DeletionProgress | null> => {
    try {
      return (
        (await runAdmin(
          Effect.flatMap(AdminSurface.Service, (s) =>
            s.getWorkspaceDeletion(requireCredential(context), data.workspaceId),
          ),
        )) ?? null
      )
    } catch {
      throw notFound()
    }
  })
