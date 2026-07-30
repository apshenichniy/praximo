import {
  AvatarRepo,
  ClientAcceptanceRepo,
  CoachBotHealthRepo,
  CoachBotProvisioningRepo,
} from "@praximo/db"
import { AvatarStore } from "@praximo/storage"
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

/**
 * A coach whose photo is nobody's business in this suite.
 *
 * `coachAvatarKey` answers rather than dying, deliberately: the photo refresh
 * runs on the tail of every provisioning path (#225), so a suite about webhooks
 * or greetings would otherwise have to know about it. Answering "no photo held"
 * and then failing loudly on any *write* keeps that quiet while still catching a
 * suite that stores one by accident.
 */
export const unusedAvatarRepo = Layer.succeed(
  AvatarRepo.Service,
  AvatarRepo.Service.of({
    coachAvatarKey: () => Effect.succeed(undefined),
    setCoachAvatar: unsupported,
  }),
)

export const unusedAvatarStore = Layer.succeed(
  AvatarStore.Service,
  AvatarStore.Service.of({ store: unsupported }),
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
