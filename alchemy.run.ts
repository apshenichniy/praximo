// The single root Alchemy 2 program for Praximo (ADR 0002, ADR 0003): all three
// Workers, the shared R2 bucket, the Neon project + per-stage branch, and the
// service-binding graph, parameterized by stage. It is the one source of truth
// for infrastructure — there is no wrangler config.
//
// This ticket (#46) brings up the **dev stage**: the three skeleton Workers with
// their Neon/R2 bindings and typed service bindings, each answering `/health` on
// its `workers.dev` URL. The pieces the full stack still needs — the migrations
// dir (#47, once the schema exists), the AI Gateway, the Email Sending
// subdomain, the pipeline Workflow + cron, and the prod custom domain / zone
// routes / `--adopt` of the existing `praximo-prod` stack — arrive with the
// slices that first use them. Their shapes are proven in
// `prototypes/infra-bootstrap` (#32).
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
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

// Every Worker shares one compatibility surface; keep it in step with the apps.
const compatibility = { date: "2026-07-19", flags: ["nodejs_compat"] }

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
    // ── Neon: one EU project, one branch per stage ──
    // region MUST be explicit — the default is aws-us-east-1 and the resource
    // diffs on region, so a wrong first deploy replaces the project (ADR 0003).
    const project = yield* Neon.Project("Db", {
      region: "aws-eu-central-1",
      pgVersion: 17,
    })
    const branch = yield* Neon.Branch("Branch", { project })

    // ── R2: the single shared bucket, EU jurisdiction ──
    const bucket = yield* Cloudflare.R2.Bucket("Uploads", {
      jurisdiction: "eu",
      locationHint: "weur",
    })

    // ── Workers: the web → pipeline → bot service-binding chain (ADR 0002) ──
    // `branch.connectionUri` is a Redacted value, so it lands as a secret_text
    // binding, not plain text.
    const bot = yield* Cloudflare.Worker("Bot", {
      main: "./apps/bot/src/index.ts",
      compatibility,
      env: { UPLOADS: bucket, DATABASE_URL: branch.connectionUri },
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

    const web = yield* Cloudflare.Worker("Web", {
      main: "./apps/web/src/index.ts",
      compatibility,
      env: {
        PIPELINE: pipeline,
        UPLOADS: bucket,
        DATABASE_URL: branch.connectionUri,
      },
    })

    return {
      neonProjectId: project.projectId,
      bucket: bucket.bucketName,
      // The workers.dev URLs (enabled by default) — hit `/health` on each.
      webUrl: web.url,
      botUrl: bot.url,
      pipelineUrl: pipeline.url,
    }
  }),
)
