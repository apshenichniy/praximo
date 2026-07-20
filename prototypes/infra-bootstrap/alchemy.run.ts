// Bootstrap-verified Alchemy stack — reference scaffold from #32.
//
// This program was deployed end-to-end against the real Cloudflare + Neon
// accounts from the three-variable root `.env` (deploy → verify → destroy),
// proving ADR 0003's principle "the agent does all devops; the human only
// supplies a secrets file". See README.md / FINDINGS.md for the run log.
//
// It is a REFERENCE, not the production program. #13 lifts this to the repo
// root as `alchemy.run.ts`, swaps the inline stub workers for the real
// `apps/{web,bot,pipeline}` entries (`main: import.meta.url` next to code),
// wires migrations from `packages/db`, and — critically — ADOPTS the existing
// live `praximo-prod` stack (a prior session already bootstrapped prod:
// workers praximo-prod-{web,api,pipeline}, alchemy-state-store, the
// app.praximo.io custom domain, app/api AAAA 100:: records) instead of
// creating from zero.
//
// Run (dev):   CI=1 bunx alchemy deploy --stage dev_<user> --yes
// Destroy:     CI=1 bunx alchemy destroy --stage dev_<user> --yes
//   CI=1 is REQUIRED for non-interactive env-var auth (else AuthError).

import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Neon from "alchemy/Neon";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// Live praximo.io zone id (zone pre-exists; Alchemy manages records within it).
const ZONE_ID = "40852c624bed7b4b2c25fa63a7fc16ac";

export default Alchemy.Stack(
  "Praximo",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Neon.providers()),
    state: Cloudflare.state(), // remote state; exercises Account Secrets Store Edit
  },
  Effect.gen(function* () {
    // ── Neon: EU project + per-stage branch + Drizzle migrations ──
    const project = yield* Neon.Project("Db", {
      region: "aws-eu-central-1", // MUST be explicit — default is aws-us-east-1, diffs on replace
      pgVersion: 17,
    });
    const branch = yield* Neon.Branch("Branch", {
      project,
      migrationsDir: "./migrations", // auto-applied at deploy over the branch's connectionUri
    });

    // ── R2: shared bucket, EU jurisdiction ──
    const bucket = yield* Cloudflare.R2.Bucket("Uploads", {
      jurisdiction: "eu",
      locationHint: "weur",
    });

    // ── AI Gateway with a daily cost cap ──
    const gateway = yield* Cloudflare.AI.Gateway("Gateway", {
      id: "praximo-gw",
      spendLimits: {
        enabled: true,
        rules: [{ limit: 5000, limitType: "cost", window: "1 day" }], // cents
      },
    });

    // ── Workers: web → pipeline → bot service-binding chain ──
    const bot = yield* Cloudflare.Worker("Bot", {
      main: "./src/bot.ts",
      compatibility: { date: "2026-07-19", flags: ["nodejs_compat"] },
      // prod: routes: [{ pattern: "api.praximo.io/telegram/*", zoneName: "praximo.io" }]
    });

    const pipeline = yield* Cloudflare.Worker("Pipeline", {
      main: "./src/pipeline.ts",
      compatibility: { date: "2026-07-19", flags: ["nodejs_compat"] },
      crons: ["*/15 * * * *"], // cron rides on Workers Scripts Edit (no group of its own)
      env: {
        BOT: bot, // service binding
        UPLOADS: bucket,
        GATEWAY: gateway,
        DATABASE_URL: branch.connectionUri, // connection URI as a secret binding
        SESSION_PIPELINE: Cloudflare.Workflow("SessionPipeline", {
          className: "SessionPipeline", // class exported from ./src/pipeline.ts
        }),
      },
      // prod: routes: [{ pattern: "api.praximo.io/livekit/*", zoneName: "praximo.io" }]
    });

    const web = yield* Cloudflare.Worker("Web", {
      main: "./src/web.ts",
      compatibility: { date: "2026-07-19", flags: ["nodejs_compat"] },
      env: { PIPELINE: pipeline }, // service binding
      // prod: domain: "app.praximo.io"  (already bound to praximo-prod-web — adopt)
    });

    // ── Email Sending subdomain (REST-provisioned; no dashboard Onboard step) ──
    const sending = yield* Cloudflare.Email.SendingSubdomain("Mail", {
      zoneId: ZONE_ID,
      name: "mail.praximo.io",
    });

    // ── Proxied AAAA placeholder for api.praximo.io (already present in prod — adopt) ──
    // yield* Cloudflare.DNS.Record("ApiApex", {
    //   zoneId: ZONE_ID, name: "api.praximo.io", type: "AAAA", content: "100::", proxied: true,
    // });

    return {
      neonProjectId: project.projectId,
      bucket: bucket.bucketName,
      gateway: gateway.id,
      webWorker: web.workerName,
      botWorker: bot.workerName,
      pipelineWorker: pipeline.workerName,
      sendingSubdomain: sending.name,
    };
  }),
);
