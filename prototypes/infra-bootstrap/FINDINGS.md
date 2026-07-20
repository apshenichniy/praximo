# #32 Part 2 — bootstrap probe findings

## Environment
- alchemy@2.0.0-beta.63 (npm tag `next`); Alchemy 2 real API differs from ADR 0003's assumed `Alchemy.Stack(...)` shape — README shows `Cloudflare.Worker(name, {main: import.meta.url}, Effect.gen)` + bindings via `Cloudflare.R2.ReadWriteBucket(Bucket)`. **ADR 0003 program-layout section needs amending.**
- bun 1.3.13, node 26.4.0.

## Preflight (read-only, before any mutation)
- CF account read OK; account id matches; account name = "Alexander.pshenichniy@gmail.com's Account".
- Zone `praximo.io` id=40852c624bed7b4b2c25fa63a7fc16ac status=active.
- `/user/tokens/verify` → success:False (result null). Expected: that endpoint is for USER tokens; this is an account-owned `cfat_` token. Account/zone/resource reads all work, so token is valid.
- **R2 entitlement CONFIRMED**: GET /r2/buckets 200; existing buckets grammsy-img, hay-cv-storage, praximo-livekit-prototype, selfieia. R2 checkout (Part 1) genuinely done → bucket create won't fail on entitlement. RISK #1 CLEARED pre-deploy.
- Neon org key OK: GET /projects 200, 0 projects (correct — creating the first is the DoD).
- Token scope GET probes all HTTP 200: Workers scripts (7 existing), AI Gateway (0), Secrets Store (**1 store already present**), Email Sending zone subdomains endpoint (empty).
  - Email Sending zone endpoint reachable via GET → strong signal the token authorizes it; POST at deploy is the definitive test of the #31 unknown.

## Deploy results (filled during execution)

### Pass 1 (dev_probe32) — DONE: 15 succeeded, all verified vs API
- Non-interactive env auth requires **CI=1** (else AuthError → wants `alchemy login`). Operational carve-out for the runbook.
- Peer deps needed beyond the 3 creds: `@effect/platform-node|bun`, `@effect/sql-pg` (all 4.0.0-beta.99), `drizzle-orm|kit@1.0.0-rc.4`. `@effect/platform` (agnostic) has NO 4.x — not needed.
- `Cloudflare.state()` came up clean (Secrets Store path works; account already had 1 store).
- Neon project `restless-dust-86715248` region **aws-eu-central-1** ✓ pg17; branch created; migration applied by deploy (drizzle).
- R2 bucket jurisdiction **eu**, location EEUR ✓ (invisible on plain endpoint; needs `cf-r2-jurisdiction: eu` header — worth knowing for verify tooling).
- AI Gateway `praximo-probe-gw` spend_limits enabled, 5000¢/day sliding ✓.
- 3 workers + service bindings (Web→Pipeline, Pipeline→Bot) + secret_text (DATABASE_URL, PROBE_SECRET) + Workflow + cron `*/15 * * * *` ✓.
- **workers.dev subdomain auto-enabled by deploy — no dashboard first-claim** (resolves #31 open Q).
- API SHAPE vs ADR 0003: Stack 3rd arg is an Effect (no ctx cb); `compatibility:{date,flags}` nested; AI Gateway = `Cloudflare.AI.Gateway`; custom domain = Worker `domain` prop; Neon default region confirmed US. → ADR 0003 program-layout needs amend.

### Pass 2 (prod-zone, LIVE praximo.io) — DONE: 13 succeeded
- **Discovery**: live zone already had `AAAA app.praximo.io 100:: proxied` and `AAAA api.praximo.io 100:: proxied` (pre-existing, plus room/turn/admin/www). Zone was NOT empty. Skipped re-creating app/api AAAA + custom-domain/route on throwaway worker (entanglement w/ intended prod web worker; #31 already rates these "Yes/confident").
- **Email Sending subdomain `mail.praximo.io` CREATED via REST, no 403, no dashboard step.** enabled:true; auto-provisioned cf-bounce MX ×3, DKIM TXT, SPF (`v=spf1 include:_spf.mx.cloudflare.net ~all`), `_dmarc.mail p=reject`. Apex `_dmarc` untouched.
  - RESOLVES #31 unknown #1 (permission group): account-scoped Email Sending Edit authorized the ZONE endpoint; no separate `Email Routing Rules Edit` zone group needed.
  - RESOLVES #31 unknown #2 (hidden dashboard "Onboard Domain"): NOT needed for a *subdomain*; REST alone fully provisions + enables.
- `_probe32-dnswrite.praximo.io` TXT created → zone `DNS Write` confirmed.
- NOT executed here (pre-existing records + entanglement, left for #13 on real prod stage): app.praximo.io custom domain, api.praximo.io/* routes, AAAA 100:: (already present).

### Pass 3 (destroy) — DONE: 10 succeeded, teardown verified
- Neon 0 projects, email-subdomains 0, R2 probe bucket gone, AI Gateway gone, zone restored to original 8 records.
- **Orphan carve-out**: `alchemy destroy` of Email SendingSubdomain left `_dmarc.mail.praximo.io` (TXT p=reject) behind — cf-bounce MX/SPF/DKIM + subdomain removed, DMARC not. Cleaned manually. → destroy is NOT 100% clean for SendingSubdomain.
- State store `alchemy-state-store` Worker + Secrets Store entry persist (expected — remote state infra, not stage-scoped).
- **Discovery**: account already had a `praximo-prod` Alchemy stack (workers praximo-prod-{web,api,pipeline,pipeline-rpc-smoke} + alchemy-state-store); the pre-existing app/api AAAA 100:: records trace to it. A prior session already bootstrapped prod. My probe was isolated on dev_probe32.

## #31 open-question resolutions
- Email Sending token permission: account-scoped Email Sending Edit authorizes the ZONE endpoint — no separate zone group, no 403. RESOLVED.
- Email Sending hidden dashboard "Onboard Domain": NOT required for a subdomain; REST fully provisions+enables. RESOLVED.
- workers.dev first-claim: auto-enabled by deploy, no dashboard. RESOLVED.
- Secrets Store Edit reachable + Cloudflare.state() works. CONFIRMED.
- R2 EU jurisdiction first-class, entitlement present. CONFIRMED.

## New carve-outs to append to #31
1. Non-interactive deploy needs `CI=1` (or `alchemy login`/profile) — else AuthError even with env creds present.
2. `alchemy destroy` leaves `_dmarc.mail.praximo.io` after SendingSubdomain teardown (manual delete needed).
3. Runtime peer deps beyond the 3 creds: @effect/platform-node|bun@4.0.0-beta.99, @effect/sql-pg@4.0.0-beta.99, drizzle-orm|kit@1.0.0-rc.4 (@effect/platform agnostic NOT needed on Effect 4).

## ADR 0003 amendments beyond the two already folded in
Program-layout section describes an API that differs from installed alchemy@2.0.0-beta.63:
- Stack 3rd arg is an Effect value, not `(ctx) => Effect.gen(...)`.
- Worker compatibility is nested `compatibility: { date, flags }` (not top-level compatibilityDate/Flags).
- AI Gateway = `Cloudflare.AI.Gateway` (from "alchemy/Cloudflare"), spend cap via `spendLimits.rules[].limit` (cents) + `window`.
- Custom domain = Worker `domain` prop; routes = `routes: [{ pattern, zoneName }]`; providers merged via `Layer.mergeAll(Cloudflare.providers(), Neon.providers())`; state via `Cloudflare.state()`.
- Add `CI=1` to the deploy invocation in the ADR's deploy section.

### Supplementary (zone confirmed fully ours) — routing primitives closed
- **Custom domain `app.praximo.io`**: probe attach REFUSED by Alchemy with a clean error — already bound to `praximo-prod-web` (the pre-existing prod stack owns it via workers/domains API). Primitive CONFIRMED working + in prod use. Not detached.
- **Zone route**: `api.praximo.io/_probe32-route/*` created → praximo-prod... no, probe worker; `Workers Routes Edit` CONFIRMED. Destroyed clean (0 routes, prod app.praximo.io→praximo-prod-web intact, workers back to 7).
- All of #32's checklist 1–9 now exercised (AAAA 100:: already present in prod; DNS Write proven via TXT probe).
