import {
  WorkspaceId,
  WorkspaceRunCancellationResult,
  type WorkspaceRunCancellationRpcClient,
} from "@praximo/domain"
import { Context, Effect, Layer, Schema } from "effect"

export interface Interface {
  readonly cancel: (workspaceId: WorkspaceId) => Effect.Effect<WorkspaceRunCancellationResult>
  readonly kickObjectCleanup: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/web/WorkspaceRunCancellation",
) {}

const unavailable = WorkspaceRunCancellationResult.cases.Failed.make({})
const nothingActive = WorkspaceRunCancellationResult.cases.NothingActive.make({})

export const layer = Layer.succeed(
  Service,
  Service.of({
    cancel: Effect.fn("WorkspaceRunCancellation.cancel")(() => Effect.succeed(nothingActive)),
    kickObjectCleanup: Effect.fn("WorkspaceRunCancellation.kickObjectCleanup")(() => Effect.void),
  }),
)

export const rpcLayer = (client: WorkspaceRunCancellationRpcClient) =>
  Layer.succeed(
    Service,
    Service.of({
      cancel: Effect.fn("WorkspaceRunCancellation.Rpc.cancel")(function* (workspaceId) {
        const result = yield* Effect.tryPromise({
          try: () => client.cancelWorkspaceRuns(workspaceId),
          catch: () => unavailable,
        }).pipe(Effect.catch((failure) => Effect.succeed(failure)))
        return yield* Schema.decodeUnknownEffect(WorkspaceRunCancellationResult)(result).pipe(
          Effect.catch(() => Effect.succeed(unavailable)),
        )
      }),
      kickObjectCleanup: Effect.fn("WorkspaceRunCancellation.Rpc.kickObjectCleanup")(() =>
        Effect.tryPromise({
          try: () => client.kickObjectCleanup(),
          catch: () => undefined,
        }).pipe(Effect.ignore),
      ),
    }),
  )

export * as WorkspaceRunCancellation from "./workspace-run-cancellation.ts"
