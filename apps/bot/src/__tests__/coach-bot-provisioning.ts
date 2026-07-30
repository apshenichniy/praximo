import { ClientAcceptanceRepo, CoachBotHealthRepo, CoachBotProvisioningRepo } from "@praximo/db"
import { BotRegistry, CoachBotCredential, ManagerBotSender } from "@praximo/telegram"
import { Effect, Layer } from "effect"

const unsupported = () => Effect.die(new Error("unexpected CoachBotProvisioning test dependency"))

export const unusedProvisioningRepo = Layer.succeed(
  CoachBotProvisioningRepo.Service,
  CoachBotProvisioningRepo.Service.of({
    prepare: unsupported,
    claim: unsupported,
    recordPrompt: unsupported,
    ingestCandidate: unsupported,
    findCandidateByBotId: unsupported,
    complete: unsupported,
    reopenForRelink: unsupported,
    findByBotId: unsupported,
    findInFlightManagedAttempt: unsupported,
    findByWorkspace: unsupported,
    workspaceProfile: unsupported,
    rotate: unsupported,
    pendingNotifications: unsupported,
    markNotificationDelivered: unsupported,
    deferNotification: unsupported,
  }),
)

export const unusedHealthRepo = Layer.succeed(
  CoachBotHealthRepo.Service,
  CoachBotHealthRepo.Service.of({
    dueForCheck: unsupported,
    findTarget: unsupported,
    markChecked: unsupported,
    flagNeedsRelink: unsupported,
    queueRepairNotice: unsupported,
  }),
)

export const unusedClientAcceptanceRepo = Layer.succeed(
  ClientAcceptanceRepo.Service,
  ClientAcceptanceRepo.Service.of({
    findByToken: unsupported,
    findByWebToken: unsupported,
    findBotOwner: unsupported,
    findAcceptedClient: unsupported,
    claim: unsupported,
  }),
)

export const unusedCredential = Layer.succeed(
  CoachBotCredential.Service,
  CoachBotCredential.Service.of({
    encrypt: unsupported,
    decrypt: unsupported,
  }),
)

export const unusedRegistry = Layer.succeed(
  BotRegistry.Service,
  BotRegistry.Service.of({
    send: unsupported,
    prepareCard: unsupported,
  }),
)

export const unusedManagerSender = Layer.succeed(
  ManagerBotSender.Service,
  ManagerBotSender.Service.of({
    sendText: unsupported,
    prepareInlineInvite: unsupported,
  }),
)
