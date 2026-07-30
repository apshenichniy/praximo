import type { CoachBotProvisioningRepo } from "@praximo/db"
import type { CoachLanguage, TelegramId } from "@praximo/domain"
import { describe, expect, expectTypeOf, it } from "vitest"
import type { Effect } from "effect"
import type { Update, User } from "grammy/types"
import { CoachBotProvisioning } from "./coach-bot-provisioning.ts"

describe("CoachBotProvisioning service contract", () => {
  it("exposes only the six runtime operations", () => {
    expectTypeOf<keyof CoachBotProvisioning.Interface>().toEqualTypeOf<
      | "offerBotCreation"
      | "provisionManagedBot"
      | "ingestBotFatherToken"
      | "completeOwnershipProof"
      | "sweepCoachBotHealth"
      | "deliverCoachNotifications"
    >()

    expect(CoachBotProvisioning.layer).toBeDefined()
    expect(CoachBotProvisioning.testLayer).toBeDefined()
  })

  it("keeps environment and transport out of every operation signature", () => {
    expectTypeOf<
      Parameters<CoachBotProvisioning.Interface["offerBotCreation"]>[0]
    >().toEqualTypeOf<CoachBotProvisioningRepo.Provisioning>()
    expectTypeOf<Parameters<CoachBotProvisioning.Interface["offerBotCreation"]>[1]>().toEqualTypeOf<
      "invitation" | "relink" | undefined
    >()
    expectTypeOf<
      Parameters<CoachBotProvisioning.Interface["offerBotCreation"]>["length"]
    >().toEqualTypeOf<1 | 2>()
    expectTypeOf<Parameters<CoachBotProvisioning.Interface["provisionManagedBot"]>>().toEqualTypeOf<
      [user: User, managedBot: User, webhookOrigin: string]
    >()
    expectTypeOf<
      Parameters<CoachBotProvisioning.Interface["ingestBotFatherToken"]>
    >().toEqualTypeOf<[coachTelegramId: TelegramId, token: string, webhookOrigin: string]>()
    expectTypeOf<
      Parameters<CoachBotProvisioning.Interface["completeOwnershipProof"]>
    >().toEqualTypeOf<
      [
        input: {
          readonly candidate: CoachBotProvisioningRepo.Candidate
          readonly secretToken: string
          readonly update: Update
          readonly webhookOrigin: string
        },
      ]
    >()
    expectTypeOf<Parameters<CoachBotProvisioning.Interface["sweepCoachBotHealth"]>>().toEqualTypeOf<
      []
    >()
    expectTypeOf<
      Parameters<CoachBotProvisioning.Interface["deliverCoachNotifications"]>
    >().toEqualTypeOf<[]>()

    type OperationRequirements = {
      [Name in keyof CoachBotProvisioning.Interface]: Effect.Services<
        ReturnType<CoachBotProvisioning.Interface[Name]>
      >
    }
    expectTypeOf<OperationRequirements>().toEqualTypeOf<{
      readonly offerBotCreation: never
      readonly provisionManagedBot: never
      readonly ingestBotFatherToken: never
      readonly completeOwnershipProof: never
      readonly sweepCoachBotHealth: never
      readonly deliverCoachNotifications: never
    }>()
  })

  it("keeps coach language on the ingestion result", () => {
    expectTypeOf<
      CoachBotProvisioning.IngestedCandidate["coachLanguage"]
    >().toEqualTypeOf<CoachLanguage>()
  })
})
