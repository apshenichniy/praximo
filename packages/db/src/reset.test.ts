import { Admin, AdminId } from "@praximo/domain"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { AdminRepo } from "./admin-repo.ts"
import {
  assertNotProd,
  makeResetSeedPlan,
  parseAdminTelegramIds,
  parseResetArgs,
  resolveStage,
  seedAdmins,
  sortAlchemyMigrationNames,
} from "./reset.ts"

// The safety-critical half of db:reset, tested with no database and no network —
// this suite runs everywhere, including CI without secrets.

describe("sortAlchemyMigrationNames", () => {
  it("matches Alchemy's recursive SQL migration ordering", () => {
    expect(
      sortAlchemyMigrationNames([
        "notes.txt",
        "20260723204615_aspiring_terror/migration.sql",
        "20260720212719_same_kulan_gath/migration.sql",
        "20260723181242_wakeful_star_brand/migration.sql",
      ]),
    ).toEqual([
      "20260720212719_same_kulan_gath/migration.sql",
      "20260723181242_wakeful_star_brand/migration.sql",
      "20260723204615_aspiring_terror/migration.sql",
    ])
  })
})

describe("assertNotProd", () => {
  it("refuses the prod stage", () => {
    expect(() => assertNotProd("prod")).toThrow(/refuses to run against prod/)
  })

  it("allows a personal dev stage", () => {
    expect(() => assertNotProd("dev_alexander")).not.toThrow()
  })

  it("allows an ad-hoc named stage", () => {
    expect(() => assertNotProd("exp-foo")).not.toThrow()
  })
})

describe("resolveStage", () => {
  it("prefers APP_STAGE when set", () => {
    expect(resolveStage({ APP_STAGE: "dev_ci", USER: "alexander" })).toBe("dev_ci")
  })

  it("falls back to the dev_<user> default", () => {
    expect(resolveStage({ USER: "alexander" })).toBe("dev_alexander")
  })

  it("throws when neither APP_STAGE nor USER is set", () => {
    expect(() => resolveStage({})).toThrow(/cannot resolve stage/)
  })
})

describe("parseAdminTelegramIds", () => {
  it("parses a single admin id", () => {
    expect(parseAdminTelegramIds("123456789")).toEqual(["123456789"])
  })

  it("parses multiple ids and tolerates surrounding whitespace", () => {
    expect(parseAdminTelegramIds(" 123456789, 987654321 ,555555555 ")).toEqual([
      "123456789",
      "987654321",
      "555555555",
    ])
  })

  it("rejects a missing admin set", () => {
    expect(() => parseAdminTelegramIds("   ")).toThrow(
      "ADMIN_TELEGRAM_IDS must contain at least one Telegram id",
    )
  })

  it.each([
    ["123,,456", 2],
    ["123, ,456", 2],
    ["123,456,", 3],
  ])("rejects an empty list entry in %s", (value, entryNumber) => {
    expect(() => parseAdminTelegramIds(value)).toThrow(
      `ADMIN_TELEGRAM_IDS entry ${entryNumber} is empty`,
    )
  })

  it.each(["abc", "-123", "0", "1.5"])("rejects malformed Telegram id %s", (value) => {
    expect(() => parseAdminTelegramIds(`123,${value}`)).toThrow(
      `ADMIN_TELEGRAM_IDS entry 2 ("${value}") must be a positive decimal Telegram id`,
    )
  })
})

describe("parseResetArgs", () => {
  it("keeps the ordinary reset free of demo workspaces", () => {
    expect(parseResetArgs([])).toBe(false)
  })

  it("enables the deterministic demo workspace seed explicitly", () => {
    expect(parseResetArgs(["--demo"])).toBe(true)
  })

  it("rejects unknown and combined arguments", () => {
    expect(() => parseResetArgs(["--demo", "--force"])).toThrow("unknown db:reset arguments")
  })
})

describe("makeResetSeedPlan", () => {
  it("keeps ordinary reset workspace-empty", () => {
    expect(makeResetSeedPlan(false)).toEqual(["admins"])
  })

  it("adds demo workspaces only after the admin seed", () => {
    expect(makeResetSeedPlan(true)).toEqual(["admins", "demo-workspaces"])
  })
})

describe("seedAdmins", () => {
  it.effect("upserts every configured id, including duplicates", () =>
    Effect.gen(function* () {
      const upserted = yield* Ref.make<ReadonlyArray<string>>([])
      const adminRepoLayer = Layer.succeed(
        AdminRepo.Service,
        AdminRepo.Service.of({
          upsertByTelegramId: Effect.fn("AdminRepo.Test.upsertByTelegramId")((telegramId) =>
            Ref.update(upserted, (ids) => [...ids, telegramId]).pipe(
              Effect.as(
                Admin.make({
                  id: AdminId.make(`adm_${telegramId}`),
                  telegramId,
                }),
              ),
            ),
          ),
          findByTelegramId: Effect.fn("AdminRepo.Test.findByTelegramId")(() =>
            Effect.die(new Error("not used by this seed test")),
          ),
        }),
      )

      yield* seedAdmins(parseAdminTelegramIds(" 123,456,123 ")).pipe(Effect.provide(adminRepoLayer))

      expect(yield* Ref.get(upserted)).toEqual(["123", "456", "123"])
    }),
  )
})
