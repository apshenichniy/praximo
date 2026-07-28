// The single Alchemy 2 program for Praximo (ADR 0002, ADR 0003): four product
// surfaces, Bot, Pipeline, the shared R2 bucket, Neon, and the service-binding
// graph. There is no wrangler configuration.
//
// The canonical product-looking addresses currently point to one disposable
// development stage. Resource names and telemetry remain stage-qualified; a
// canonical hostname never selects production data. Public praximo.io is not a
// resource in this stack and remains unchanged.
//
// Run:     bun run deploy
// Rehearse: bun run deploy --dry-run

import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Output from "alchemy/Output"
import * as Neon from "alchemy/Neon"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

const compatibility = { date: "2026-07-19", flags: ["nodejs_compat"] }
const canonicalDevelopmentStage = "dev_apshenichniy"

const canonicalDomains = {
  admin: "admin.praximo.io",
  coach: "coach.praximo.io",
  client: "me.praximo.io",
  www: "stage.praximo.io",
} as const

const requiredUrl = (name: string, url: Output.Output<string | undefined>) =>
  Output.map(url, (value) => {
    if (value === undefined) {
      throw new Error(`${name} has no URL: bind a domain or leave workers.dev enabled`)
    }
    return value
  })

export default Alchemy.Stack(
  "Praximo",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Neon.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    const canonical = stage === canonicalDevelopmentStage
    const managerBotToken = Config.redacted("MANAGER_BOT_TOKEN")
    const managerBotUsername = Config.string("MANAGER_BOT_USERNAME")
    const managerBotWebhookSecret = Config.redacted("MANAGER_BOT_WEBHOOK_SECRET")
    const managerBotWebhookUrl = Config.string("MANAGER_BOT_WEBHOOK_URL").pipe(
      Config.withDefault(""),
    )
    const coachBotCredentialKey = Config.redacted("COACH_BOT_CREDENTIAL_KEY")
    const configuredCoachMiniAppUrl = Config.string("COACH_MINI_APP_URL")
    const defaultCoachBotAvatarR2Key = Config.string("DEFAULT_COACH_BOT_AVATAR_R2_KEY")
    const telegramEnv = Config.string("TELEGRAM_ENV").pipe(Config.withDefault("production"))

    const project = yield* Neon.Project("Db", {
      region: "aws-eu-central-1",
      pgVersion: 17,
    })
    const branch = yield* Neon.Branch("Branch", {
      project,
      migrationsDir: "./packages/db/migrations",
    })
    const bucket = yield* Cloudflare.R2.Bucket("Uploads", {
      jurisdiction: "eu",
      locationHint: "weur",
    })

    // Client is independent and declared first because Coach and Bot consume its
    // deployed origin for public legal URLs.
    const client = yield* Cloudflare.Website.Vite("Client", {
      rootDir: "./apps/client",
      compatibility,
      ...(canonical ? { domain: canonicalDomains.client } : {}),
    })
    const clientAppUrl = requiredUrl("Client", client.url)

    // Bot and Coach form a logical cycle: Bot creates a Coach launch URL, while
    // Coach calls BotRegistry over RPC. The stable canonical Coach origin breaks
    // that resource cycle for the one active environment; personal stages keep
    // supplying their generated Coach origin through configuration.
    const coachMiniAppUrl = canonical
      ? `https://${canonicalDomains.coach}/`
      : configuredCoachMiniAppUrl

    const bot = yield* Cloudflare.Worker("Bot", {
      main: "./apps/bot/src/index.ts",
      compatibility,
      crons: ["*/5 * * * *"],
      env: {
        UPLOADS: bucket,
        DATABASE_URL: branch.connectionUri,
        MANAGER_BOT_TOKEN: managerBotToken,
        MANAGER_BOT_USERNAME: managerBotUsername,
        MANAGER_BOT_WEBHOOK_SECRET: managerBotWebhookSecret,
        MANAGER_BOT_WEBHOOK_URL: managerBotWebhookUrl,
        COACH_BOT_CREDENTIAL_KEY: coachBotCredentialKey,
        COACH_MINI_APP_URL: coachMiniAppUrl,
        CLIENT_APP_URL: clientAppUrl,
        DEFAULT_COACH_BOT_AVATAR_R2_KEY: defaultCoachBotAvatarR2Key,
      },
    })

    const pipeline = yield* Cloudflare.Worker("Pipeline", {
      main: "./apps/pipeline/src/index.ts",
      compatibility,
      crons: ["*/15 * * * *"],
      env: {
        BOT: bot,
        UPLOADS: bucket,
        DATABASE_URL: branch.connectionUri,
      },
    })

    const admin = yield* Cloudflare.Website.Vite("Admin", {
      rootDir: "./apps/admin",
      compatibility,
      ...(canonical ? { domain: canonicalDomains.admin } : {}),
      env: {
        PIPELINE: pipeline,
        MANAGER_BOT: bot,
        DATABASE_URL: branch.connectionUri,
        MANAGER_BOT_TOKEN: managerBotToken,
        MANAGER_BOT_USERNAME: managerBotUsername,
      },
    })

    const coach = yield* Cloudflare.Website.Vite("Coach", {
      rootDir: "./apps/coach",
      compatibility,
      ...(canonical ? { domain: canonicalDomains.coach } : {}),
      env: {
        MANAGER_BOT: bot,
        DATABASE_URL: branch.connectionUri,
        MANAGER_BOT_USERNAME: managerBotUsername,
        TELEGRAM_ENV: telegramEnv,
        CLIENT_APP_URL: clientAppUrl,
      },
    })

    const www = yield* Cloudflare.Website.StaticSite("Www", {
      cwd: "./apps/www",
      command: "bun run build",
      outdir: "dist",
      compatibility,
      ...(canonical ? { domain: canonicalDomains.www } : {}),
      assets: {
        htmlHandling: "auto-trailing-slash",
        notFoundHandling: "none",
      },
    })

    return {
      stage,
      neonProjectId: project.projectId,
      bucket: bucket.bucketName,
      adminUrl: admin.url,
      coachUrl: coach.url,
      clientUrl: client.url,
      wwwUrl: www.url,
      botUrl: bot.url,
      pipelineUrl: pipeline.url,
    }
  }),
)
