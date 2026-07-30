import {
  AvatarRepo,
  ClientAcceptanceRepo,
  CoachBotHealthRepo,
  CoachBotProvisioningRepo,
} from "@praximo/db"
import type { TelegramId } from "@praximo/domain"
import { AvatarStore } from "@praximo/storage"
import { BotRegistry, CoachBotCredential, ManagerBotSender } from "@praximo/telegram"
import type { Update, User } from "grammy/types"
import { Context, Effect, Layer } from "effect"
import { CoachBotProvisioningRuntime } from "./coach-bot-provisioning-runtime.ts"
import { sweepCoachBotHealth } from "./coach-bot-health.ts"
import { deliverCoachNotifications, offerBotCreation, provisionManagedBot } from "./provisioning.ts"
import {
  completeOwnershipProof,
  ingestBotFatherToken,
  type IngestedCandidate,
  type ProofInput,
} from "./token-fallback.ts"

type OfferBotCreationEffect = ReturnType<typeof offerBotCreation>
type ProvisionManagedBotEffect = ReturnType<typeof provisionManagedBot>
type IngestBotFatherTokenEffect = ReturnType<typeof ingestBotFatherToken>
type CompleteOwnershipProofEffect = ReturnType<typeof completeOwnershipProof>
type SweepCoachBotHealthEffect = ReturnType<typeof sweepCoachBotHealth>
type DeliverCoachNotificationsEffect = ReturnType<typeof deliverCoachNotifications>
type OperationalServices =
  | CoachBotProvisioningRepo.Service
  | CoachBotHealthRepo.Service
  | ClientAcceptanceRepo.Service
  | AvatarRepo.Service
  | AvatarStore.Service
  | CoachBotCredential.Service
  | BotRegistry.Service
  | ManagerBotSender.Service

type Operation<EffectType extends Effect.Effect<unknown, unknown, unknown>> = Effect.Effect<
  Effect.Success<EffectType>,
  Effect.Error<EffectType>
>

export interface Interface {
  readonly offerBotCreation: (
    setup: CoachBotProvisioningRepo.Provisioning,
    intent?: "invitation" | "relink",
  ) => Operation<OfferBotCreationEffect>
  readonly provisionManagedBot: (
    user: User,
    managedBot: User,
    webhookOrigin: string,
  ) => Operation<ProvisionManagedBotEffect>
  readonly ingestBotFatherToken: (
    coachTelegramId: TelegramId,
    token: string,
    webhookOrigin: string,
  ) => Operation<IngestBotFatherTokenEffect>
  readonly completeOwnershipProof: (input: {
    readonly candidate: CoachBotProvisioningRepo.Candidate
    readonly secretToken: string
    readonly update: Update
    readonly webhookOrigin: string
  }) => Operation<CompleteOwnershipProofEffect>
  readonly sweepCoachBotHealth: () => Operation<SweepCoachBotHealthEffect>
  readonly deliverCoachNotifications: () => Operation<DeliverCoachNotificationsEffect>
}

export class Service extends Context.Service<Service, Interface>()(
  "BotWorker/CoachBotProvisioning",
) {}

const makeLayer = <E, R>(runtimeLayer: Layer.Layer<CoachBotProvisioningRuntime.Service, E, R>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const runtime = yield* CoachBotProvisioningRuntime.Service
      // Captured at construction so callers depend only on this service, never
      // on the repositories and transports it happens to orchestrate.
      const services = yield* Effect.context<OperationalServices>()

      const provideOperationServices = <A, OperationError>(
        effect: Effect.Effect<
          A,
          OperationError,
          OperationalServices | CoachBotProvisioningRuntime.Service
        >,
      ) =>
        effect.pipe(
          Effect.provideContext(services),
          Effect.provideService(CoachBotProvisioningRuntime.Service, runtime),
        )

      const offer = Effect.fn("CoachBotProvisioning.offerBotCreation")(function* (
        setup: CoachBotProvisioningRepo.Provisioning,
        intent: "invitation" | "relink" = "invitation",
      ) {
        return yield* provideOperationServices(offerBotCreation(setup, intent))
      })

      const provision = Effect.fn("CoachBotProvisioning.provisionManagedBot")(function* (
        user: User,
        managedBot: User,
        webhookOrigin: string,
      ) {
        return yield* provideOperationServices(provisionManagedBot(user, managedBot, webhookOrigin))
      })

      const ingest = Effect.fn("CoachBotProvisioning.ingestBotFatherToken")(function* (
        coachTelegramId: TelegramId,
        token: string,
        webhookOrigin: string,
      ) {
        return yield* provideOperationServices(
          ingestBotFatherToken(coachTelegramId, token, webhookOrigin),
        )
      })

      const complete = Effect.fn("CoachBotProvisioning.completeOwnershipProof")(function* (
        input: ProofInput,
      ) {
        return yield* provideOperationServices(completeOwnershipProof(input))
      })

      const sweep = Effect.fn("CoachBotProvisioning.sweepCoachBotHealth")(function* () {
        return yield* provideOperationServices(sweepCoachBotHealth())
      })

      const deliver = Effect.fn("CoachBotProvisioning.deliverCoachNotifications")(function* () {
        return yield* provideOperationServices(deliverCoachNotifications())
      })

      return Service.of({
        offerBotCreation: offer,
        provisionManagedBot: provision,
        ingestBotFatherToken: ingest,
        completeOwnershipProof: complete,
        sweepCoachBotHealth: sweep,
        deliverCoachNotifications: deliver,
      })
    }),
  ).pipe(Layer.provide(runtimeLayer))

export const layer = (uploads: R2Bucket) => makeLayer(CoachBotProvisioningRuntime.layer(uploads))

export const testLayer = (uploads: R2Bucket, fetch: typeof globalThis.fetch) =>
  makeLayer(CoachBotProvisioningRuntime.testLayer(uploads, fetch))

export type { IngestedCandidate }

export * as CoachBotProvisioning from "./coach-bot-provisioning.ts"
