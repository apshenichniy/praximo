# infra-bootstrap — #32 bootstrap-verified Alchemy stack

Reference scaffold produced while resolving
[#32](https://github.com/apshenichniy/praximo/issues/32). It was deployed
end-to-end against the **real** Cloudflare + Neon accounts from the
three-variable root `.env` (deploy → verify against live APIs → destroy),
proving [ADR 0003](../../docs/adr/0003-alchemy-iac-structure.md)'s principle
"the agent does all devops; the human only supplies a secrets file."

This is a **reference**, not the production program. The real root
`alchemy.run.ts` is [#13](https://github.com/apshenichniy/praximo/issues/13)'s
job — see [Handoff to #13](#handoff-to-13).

## Files

- `alchemy.run.ts` — the full stack (Neon EU + branch + migrations, R2 `eu`,
  `Cloudflare.state()`, AI Gateway + spend cap, 3 Workers + service bindings +
  Workflow + cron, `mail.praximo.io` Email Sending). Stub workers in `src/`.
- `domain-probe.run.ts` — the isolated routing probe (custom domain + zone route).
- `src/{web,bot,pipeline}.ts` — minimal stub Workers (`pipeline` exports the
  `SessionPipeline` WorkflowEntrypoint).
- `migrations/0000_init.sql` — trivial migration, proves `migrationsDir` applies.
- `FINDINGS.md` — the full run log, every verification, and every carve-out.

## Run

Requires the three vars in the repo-root `.env` (`CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, `NEON_API_KEY`). **`CI=1` is mandatory** for
non-interactive env-var auth.

```sh
bun install
ln -sf ../../.env .env         # provider creds
CI=1 bunx alchemy deploy --stage dev_$USER --yes
CI=1 bunx alchemy destroy --stage dev_$USER --yes
```

## What was proven (see FINDINGS.md for the API-verified detail)

- Neon project **`aws-eu-central-1`** from scratch + per-stage branch +
  Drizzle migration at deploy.
- R2 **`jurisdiction: eu`** (location EEUR); entitlement present.
- `Cloudflare.state()` state store (Account Secrets Store Edit).
- AI Gateway with a daily cost cap.
- 3 Workers + service bindings + **Workflow + cron** (both ride on
  `Workers Scripts Edit`, no group of their own).
- **`mail.praximo.io` Email Sending via REST — no 403, no dashboard step**
  (resolves #31's two flagged email unknowns).
- `workers.dev` subdomain auto-claimed; zone `Workers Routes Edit` + `DNS Write`.
- `alchemy destroy` clean (one orphan: leaves `_dmarc.mail` — delete manually).

## Handoff to #13

1. Lift `alchemy.run.ts` to the repo root; point `main` at the real
   `apps/{web,bot,pipeline}/src` entries; remove the `apps/*/wrangler.jsonc`
   stubs (per ADR 0003 consequences).
2. **Adopt the existing live `praximo-prod` stack** — a prior session already
   bootstrapped prod (workers `praximo-prod-{web,api,pipeline}`,
   `alchemy-state-store`, the `app.praximo.io` custom domain, and the
   `app`/`api` `AAAA 100::` records). Deploy with `--adopt`, do not create from
   zero, or the custom-domain/DNS resources collide.
3. Add the peer deps (`@effect/platform-node|bun`, `@effect/sql-pg`,
   `drizzle-orm|kit`) to the workspace and wire migrations from `packages/db`.
4. Add `CI=1` to the deploy invocation (dev + the GitHub Actions prod job).
