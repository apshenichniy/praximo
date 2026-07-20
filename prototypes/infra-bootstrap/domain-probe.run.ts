import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

// Supplementary #32 probe: the two routing primitives deferred from Pass 2 —
// Worker custom domain (app.praximo.io) + zone path route (api.praximo.io/*).
// Zone is fully ours now; free to bind any host.

export default Alchemy.Stack(
  "PraximoDomainProbe",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    // app.praximo.io custom domain is already bound to praximo-prod-web (confirmed
    // working, in prod use) — not re-tested here to avoid detaching the real worker.
    // Route primitive tested on a non-colliding path.
    const app = yield* Cloudflare.Worker("App", {
      main: "./src/web.ts",
      compatibility: { date: "2026-07-19", flags: ["nodejs_compat"] },
      routes: [
        { pattern: "api.praximo.io/_probe32-route/*", zoneName: "praximo.io" },
      ],
    });

    return { worker: app.workerName };
  }),
);
