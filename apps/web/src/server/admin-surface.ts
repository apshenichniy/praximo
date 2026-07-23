import { ManagerInitData } from "@praximo/auth"
import { AdminRepo, WorkspaceRepo } from "@praximo/db"
import { Context, Effect, Layer, Schema } from "effect"

export interface Interface {
  readonly listWorkspaces: (
    initData: string,
  ) => Effect.Effect<ReadonlyArray<WorkspaceRepo.ListItem>, AccessDenied | LoadFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/web/AdminSurface") {}

export class AccessDenied extends Schema.TaggedErrorClass<AccessDenied>()(
  "AdminSurface.AccessDenied",
  {},
) {}

export class LoadFailed extends Schema.TaggedErrorClass<LoadFailed>()("AdminSurface.LoadFailed", {
  operation: Schema.String,
}) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const initData = yield* ManagerInitData.Service
    const admins = yield* AdminRepo.Service
    const workspaces = yield* WorkspaceRepo.Service

    const listWorkspaces = Effect.fn("AdminSurface.listWorkspaces")(function* (
      rawInitData: string,
    ) {
      const telegramId = yield* initData
        .verify(rawInitData)
        .pipe(Effect.mapError(() => new AccessDenied()))

      yield* admins
        .findByTelegramId(telegramId)
        .pipe(
          Effect.mapError((error) =>
            error._tag === "Domain.AdminNotFound"
              ? new AccessDenied()
              : new LoadFailed({ operation: "findAdmin" }),
          ),
        )

      return yield* workspaces
        .list()
        .pipe(Effect.mapError(() => new LoadFailed({ operation: "listWorkspaces" })))
    })

    return Service.of({ listWorkspaces })
  }),
)

export * as AdminSurface from "./admin-surface.ts"
