// The single root Alchemy 2 program for Praximo (ADR 0002, ADR 0003): all three
// Workers, the shared R2 bucket, the Neon project + per-stage branch, and the
// service-binding graph, parameterized by stage. It is the one source of truth
// for infrastructure — there is no wrangler config.
//
// This ticket (#46) brings up the **dev stage**: the three skeleton Workers with
// their Neon/R2 bindings and typed service bindings, each answering `/health`.
// The canonical web Worker also owns `stage.praximo.io` (#84); workers.dev stays
// enabled on every Worker and is the only URL for non-canonical dev stages. #47
// wired the Drizzle migrations dir onto the Neon branch below. The pieces the
// full stack still needs — the AI Gateway, the Email Sending subdomain, the
// pipeline Workflow + cron, and the prod custom domain / zone routes / `--adopt`
// of the existing `praximo-prod` stack — arrive with the slices that first use
// them. Their shapes are proven in `prototypes/infra-bootstrap` (#32).
//
// Workers are declared inline here with string `main` paths, not via the
// co-located `class Web extends Cloudflare.Worker<Web>()(...)` form ADR 0003's
// program-layout prose describes. That prose was written against an assumed API;
// #32 verified the installed alchemy@2.0.0-beta.63 differs and flagged the
// section for amendment (prototypes/infra-bootstrap/FINDINGS.md, "ADR 0003
// program-layout section needs amending"). This file follows the shape that was
// actually deployed end-to-end there.
//
// Run (dev):   CI=1 bunx alchemy deploy --stage dev_<user> --yes
// Destroy:     CI=1 bunx alchemy destroy --stage dev_<user> --yes
//   CI=1 is REQUIRED for non-interactive env-var auth (else AuthError — ADR 0003).

import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Neon from "alchemy/Neon"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

// Every Worker shares one compatibility surface; keep it in step with the apps.
const compatibility = { date: "2026-07-19", flags: ["nodejs_compat"] }
const canonicalDevStage = "dev_apshenichniy"
const canonicalDevWebDomain = "stage.praximo.io"

export default Alchemy.Stack(
  "Praximo",
  {
    // Cloudflare + Neon providers authenticate from the three root `.env` creds
    // (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / NEON_API_KEY).
    providers: Layer.mergeAll(Cloudflare.providers(), Neon.providers()),
    // Remote state (Durable Object + SQLite in our account) — survives machine
    // changes and is required for CI. Exercises Account Secrets Store Edit.
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    const managerBotToken = Config.redacted("MANAGER_BOT_TOKEN")

    // ── Neon: one EU project, one branch per stage ──
    // region MUST be explicit — the default is aws-us-east-1 and the resource
    // diffs on region, so a wrong first deploy replaces the project (ADR 0003).
    const project = yield* Neon.Project("Db", {
      region: "aws-eu-central-1",
      pgVersion: 17,
    })
    // Drizzle migrations auto-apply at deploy over the branch's connectionUri,
    // tracked in `neon_migrations` and re-applied only when file hashes change
    // (ADR 0003). db:reset replays the same dir locally against the dev branch.
    const branch = yield* Neon.Branch("Branch", {
      project,
      migrationsDir: "./packages/db/migrations",
    })

    // ── R2: the single shared bucket, EU jurisdiction ──
    const bucket = yield* Cloudflare.R2.Bucket("Uploads", {
      jurisdiction: "eu",
      locationHint: "weur",
    })

    // ── Workers: typed service-binding graph (ADR 0002) ──
    // `branch.connectionUri` is a Redacted value, so it lands as a secret_text
    // binding, not plain text.
    const bot = yield* Cloudflare.Worker("Bot", {
      main: "./apps/bot/src/index.ts",
      compatibility,
      env: {
        UPLOADS: bucket,
        DATABASE_URL: branch.connectionUri,
        MANAGER_BOT_TOKEN: managerBotToken,
      },
    })

    const pipeline = yield* Cloudflare.Worker("Pipeline", {
      main: "./apps/pipeline/src/index.ts",
      compatibility,
      env: {
        BOT: bot,
        UPLOADS: bucket,
        DATABASE_URL: branch.connectionUri,
      },
    })

    // The `web` app is a TanStack Start project (#77): Alchemy builds it with
    // its own injected Cloudflare Vite plugin (single `vite build`, server
    // bundle + client assets), so `rootDir` points at the app and there is no
    // `main`. `memo` is left at its default — hashing the full non-gitignored
    // tree over-rebuilds but never skips a needed rebuild; scoping it is a
    // later efficiency tweak. The binding graph is unchanged (ADR 0002/0003).
    const web = yield* Cloudflare.Website.Vite("Web", {
      rootDir: "./apps/web",
      compatibility,
      // BotFather persists one Main Mini App URL per bot and its input rejects
      // the generated workers.dev hostname. Keep the canonical dev stand on a
      // stable short domain; other personal stages retain their isolated URLs.
      ...(stage === canonicalDevStage ? { domain: canonicalDevWebDomain } : {}),
      env: {
        PIPELINE: pipeline,
        // Native RPC, not public HTTP: admin operations use this narrow
        // capability to send through the bot-owned manager-bot transport.
        MANAGER_BOT: bot,
        UPLOADS: bucket,
        DATABASE_URL: branch.connectionUri,
        // The manager bot's token, held as a stack secret (ADR 0004): the admin
        // route validates its Mini App `initData` by HMAC against this same token
        // (admin-surface.md §Auth). Resolved from the root `.env` at deploy and
        // bound as secret_text. The bot Worker receives the same stack secret
        // for outbound delivery; per-coach tokens remain runtime database data.
        MANAGER_BOT_TOKEN: managerBotToken,
      },
    })

    return {
      neonProjectId: project.projectId,
      bucket: bucket.bucketName,
      // `web.url` prefers its custom domain; the other Workers return workers.dev.
      webUrl: web.url,
      botUrl: bot.url,
      pipelineUrl: pipeline.url,
    }
  }),
)
