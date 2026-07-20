# Research: agent-operable infra — Cloudflare + Neon token scopes and API coverage gaps

- **Date**: 2026-07-20
- **Ticket**: [#31](https://github.com/apshenichniy/praximo/issues/31) (blocks [#13](https://github.com/apshenichniy/praximo/issues/13), [#32](https://github.com/apshenichniy/praximo/issues/32))
- **Question**: given only secrets in a root `.env`, what can an agent actually operate on Cloudflare and Neon for the [ADR 0003](../adr/0003-alchemy-iac-structure.md) stack, and where does it hit a wall?
- **Scope**: token scopes and API coverage gaps only. Bootstrap-from-zero (account creation, domain purchase), Cloudflare MCP servers / Workers Builds / Agents SDK, and agent-facing observability are out.

## Recommendation

**ADR 0003's principle holds, with a bounded once-ever carve-out and one recurring exception.** Every steady-state operation the stack performs — Workers upload, routes, custom domains, DNS records, Durable Objects + SQLite state store, R2 with EU jurisdiction, Workflows, cron triggers, AI Gateway with spend limits, the Email Sending subdomain, and the whole Neon project/branch/migration lifecycle — is API-drivable from **one account-scoped Cloudflare API token plus one Neon organization API key**. Nothing in the stack forces a Global API Key.

The wall is entirely at **bootstrap**: eight dashboard/console actions that happen once, before the agent has credentials, and that no token can perform because they are the acts that mint the credentials or attach money to the account. Two of them are structural (Cloudflare's "Create Additional Tokens" template is the *only* way to obtain `API Tokens Write`; Neon has no `POST /organizations`), and the rest are billing and entitlement purchases — including a **separate R2 checkout flow** that is distinct from Workers Paid and blocks bucket creation until done.

The one **recurring** exception is Cloudflare's Email Sending daily-quota increase, which is a Google Form. At MVP volume it should never bind.

Two facts materially change how the stack must be written and are called out in [Consequences for ADR 0003](#consequences-for-adr-0003): Alchemy's `Cloudflare.state()` needs an **Account Secrets Store Edit** permission that ADR 0003 assumed away, and `Neon.Project` defaults to **`aws-us-east-1`** — the EU region must be set explicitly.

## Coverage table — Cloudflare

Resource notation: `A` = account-scoped policy on `com.cloudflare.api.account.<id>`, `Z` = zone-scoped policy on the `praximo.io` zone only, `U` = user-scoped.

| Surface (ADR 0003) | API-drivable? | Required token permission | Manual exception |
|---|---|---|---|
| Workers scripts — upload, delete, bindings, `secret_text` | Yes | `A` Workers Scripts Edit | — |
| Service bindings (web → pipeline → bot RPC) | Yes — part of the script upload | `A` Workers Scripts Edit | — |
| Durable Objects + SQLite (app DOs and the Alchemy state store) | Yes — namespaces are created implicitly by the script's migrations; no separate permission group exists | `A` Workers Scripts Edit | — |
| Alchemy `Cloudflare.state()` bearer token | Yes — Alchemy stores it in the **account-wide Cloudflare Secrets Store** | `A` **Account Secrets Store Edit** | — (but see [Consequences](#consequences-for-adr-0003)) |
| Workflows (`Cloudflare.Workflow` in `apps/pipeline`) | Yes | `A` Workers Scripts Edit (`Workers Scripts Write` in the API) — no dedicated Workflows group | — |
| Cron triggers | Yes — `PUT /accounts/{id}/workers/scripts/{name}/schedules` | `A` Workers Scripts Edit | — |
| R2 bucket | Yes | `A` Workers R2 Storage Edit | — |
| R2 **EU jurisdiction** (`jurisdiction: "eu"`) and `locationHint` | Yes — first-class fields on `POST /accounts/{id}/r2/buckets`. Alchemy types `jurisdiction: "default" \| "eu" \| "fedramp"` and `locationHint: "apac" \| "eeur" \| "enam" \| "weur" \| "wnam" \| "oc"`, both **immutable after create** (`Cloudflare/R2/Bucket.ts`) | `A` Workers R2 Storage Edit | — |
| **R2 account entitlement** | **No** — *"You need a Cloudflare account with an R2 subscription… Go to the Cloudflare Dashboard. Select **Storage & databases > R2 > Overview**. Complete the checkout flow to add an R2 subscription to your account"* ([R2 get started](https://developers.cloudflare.com/r2/get-started/)) | — | **Once-ever.** Hard blocker: `POST /r2/buckets` fails without it, separately from Workers Paid |
| Queues (zero in MVP) | Yes | `A` Queues Edit | — |
| Workers routes on `api.praximo.io/*` | Yes | `Z` Workers Routes Edit | — |
| Worker custom domain `app.praximo.io` | Yes — `PUT /accounts/{id}/workers/domains`; Cloudflare "create[s] DNS records and issue[s] necessary certificates on your behalf" ([docs](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)) | `A` Workers Scripts Edit + `Z` Zone Read | Requires an **active zone** (once-ever, already satisfied) |
| Worker custom domain — **teardown** | Partially — *"When you delete a Custom Domain, the associated Advanced Certificate is **not** automatically deleted"*; removal is a dashboard action under SSL/TLS ([docs](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)) | — | **Recurring, teardown-only.** Triggered by removing or renaming `app.praximo.io`, never by a normal deploy |
| DNS records in `praximo.io` (incl. the proxied `AAAA 100::`) | Yes | `Z` DNS Write | — |
| Zone read for `praximo.io` | Yes | `Z` Zone Read | — |
| Zone creation + nameserver delegation | Zone create is API-drivable; **delegation happens at the registrar** | `A` Zone Write | **Once-ever.** Moot for us — ADR 0003 states the zone pre-exists |
| AI Gateway — create/update, spend limits | Yes — `POST/PUT /accounts/{id}/ai-gateway/gateways`; Alchemy models per-gateway `limitType: "cost"` rules | `A` AI Gateway Edit | — |
| AI Gateway — provider (BYOK) keys | Yes — Alchemy ships `AI.ProviderKey` / `AI.GatewayProvider` with rate/spend limits | `A` AI Gateway Edit (+ `A` Account Secrets Store Edit if the key is stored as a Secrets Store secret) | ⚠️ see [unverified](#claims-not-verified-against-a-primary-source) |
| Email Sending — **sending subdomain** `mail.praximo.io` | **Yes** — `POST /zones/{zone_id}/email/sending/subdomains`; SPF/DKIM/DMARC/`cf-bounce` records auto-created for zones on Cloudflare DNS | **`Email Sending Write`** — see [permission-group names](#permission-group-names-verified-against-alchemys-vendored-catalogue) | — |
| Email Sending — **apex domain onboarding** | **No** — docs describe only dashboard **Compute → Email Service → Email Sending → Onboard Domain**; the REST API exposes subdomains only | — | **Once-ever, avoidable.** Using `mail.praximo.io` (which the [email-provider research](email-provider.md) already picked) sidesteps it entirely |
| Email Sending — zone-level enablement flag | Yes — "the zone flag is automatically set when the entitlement is present" (entitlement = Workers Paid) | as above | — |
| Email Sending — verified destination addresses | Address creation is API-drivable; **verification is a click in a confirmation email** | `A` Email Routing Addresses Edit | **Recurring, but only pre-onboarding** — after a sending domain is onboarded you can send to any recipient |
| Email Sending — daily quota increase | **No** — a [Google Form](https://forms.gle/eX6pXvit1wBv77Yw5) | — | **Recurring / on demand.** Should not bind at MVP volume |
| Workers Paid subscription ($5/mo) | Endpoints exist (`POST/PUT /accounts/{id}/subscriptions`, `A` Billing Edit); **self-serve Workers Paid signup via API is not documented**, and a payment method must already exist | `A` Billing Edit | **Once-ever.** Treat as a dashboard step |
| Creating further API tokens | **Yes** — `POST /user/tokens` and `POST /accounts/{id}/tokens` (Alchemy: `Cloudflare.ApiToken.AccountApiToken`) | `U` API Tokens Edit / Write | **Once-ever.** The bootstrap token can *only* be made in the dashboard: *"The option for API Tokens::Edit is not available in any other template or in the Custom Token builder"* — you must use the **Create Additional Tokens** template |
| Creating **account-owned** tokens (the durable CI kind) | Yes | as above | **Once-ever.** *"Creating an account owned token requires Super Administrator permission on the account"* |

### Does anything force a Global API Key?

**No.** Alchemy's `Cloudflare/Credentials.ts` accepts three credential shapes — `apiToken`, `apiKey` (Global API Key + `CLOUDFLARE_EMAIL`), and `oauth` — so the Global API Key is *supported*, not *required*. Alchemy's own CI tutorial recommends it for the token-minting `admin` profile purely for convenience (*"Most people use the Global API Key here because the token-permissions UI in the Cloudflare dashboard is fiddly"*), and explicitly warns to keep the everyday profile on a narrow token. Account API tokens are marked ✅ for Workers, Durable Objects, Workflows, Queues, R2, Workers KV, DNS, AI Gateway, and Zone/Domain Management in Cloudflare's compatibility matrix — every surface this stack uses. Registrar, Page Rules, and Turnstile are ❌ there, none of which we touch.

### Account-level constraints an agent can trip

- **Rate limit**: 1,200 requests / 5 minutes per user/account token, cumulative across dashboard, API key, and token. Exceeding it blocks *all* API calls for the next five minutes with `HTTP 429`. A large single-pass `alchemy deploy` is well under this, but a `destroy`+`deploy` loop or a wide `unsafe nuke` is the plausible tripwire. Cloudflare's SDKs honour the `Ratelimit` / `retry-after` headers and back off.
- **Token quota**: 50 user tokens, 500 account tokens.
- **DNS propagation**: Cloudflare warns DNS changes can take up to 24 hours, "usually 5–15 minutes for domains using Cloudflare DNS". Email Sending subdomain validation depends on this, so `enabled` may lag a single deploy pass.
- **Email confirmation mid-flow**: only for verified destination addresses (see table). No 2FA challenge exists on any API path in scope.

### Permission-group names, verified against Alchemy's vendored catalogue

Cloudflare's [published permissions reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) truncates on fetch and its Zone section could not be read end-to-end. Alchemy 2 ships a **1,910-line verbatim copy** of the same reference at `src/Cloudflare/ApiToken/PermissionGroups.ts` — each entry carries `id`, `name`, `description` and `scopes`, with the header comment *"Static catalog of Cloudflare API token permission groups… @see https://developers.cloudflare.com/fundamentals/api/reference/permissions/"*. Enumerating it resolves three items this document previously listed as inference:

- **`Email Sending Read` / `Email Sending Write` exist**, described as *"Grants access to reading data from Email Sending"* / *"…reading and writing data from Email Sending"*, scoped `com.cloudflare.api.account`. The Email Routing groups are a **different product** and are not the right grant. ⚠️ Residual caveat: the endpoint is zone-scoped (`POST /zones/{zone_id}/email/sending/subdomains`) while the group is catalogued account-scoped. *Inference*: an account policy should authorize a zone path under that account. **Verify empirically in [#13](https://github.com/apshenichniy/praximo/issues/13)**; if it 403s, add the group to the zone policy as well.
- **`Account API Tokens Read` / `Account API Tokens Write` exist**, scoped `com.cloudflare.api.account` — so minting *account-owned* tokens does **not** require a user-scoped grant, only the account-scoped one (plus Super Administrator for the human doing the initial dashboard step).
- **`Secrets Store Read` / `Secrets Store Write`** are the catalogue's spellings (`com.cloudflare.api.account`); the dashboard renders these as *Account Secrets Store Read/Edit*. Same capability, two labels.

Also confirmed by absence: grepping the catalogue for `durable|workflow|cron` returns only Hyperdrive, Pipelines and Vectorize. **Durable Objects, Workflows and Cron Triggers have no permission group of their own** and ride entirely on `Workers Scripts Write`. Good for token minimality, notable for blast radius — a token that can deploy a Worker can also destroy the Durable Object namespace backing the Alchemy state store.

One further clarification on token minting: Cloudflare states a token-creating token *"can create tokens with access to any of a user's resources"* and therefore recommends *"do not grant other permissions to the token"*, bounded by IP filter or TTL ([create via API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/)). **A token can mint a token more privileged than itself** — which is what makes rotation and scope-widening agent-operable after the one dashboard-minted seed, and why the seed must not live in `.env`.

## Coverage table — Neon

| Surface | API-drivable? | Key kind required | Manual exception |
|---|---|---|---|
| Organization creation | **No** — the API reference lists no `POST /organizations`; the console docs say *"use the **Create organization** button in the org switcher"* | — | **Once-ever** |
| Plan selection / billing | **No** — *"Select a plan for your new organization … if you choose a paid plan, you'll enter billing details"* | — | **Once-ever** (Free plan is a valid choice) |
| First personal API key | **No** — *"You'll need an existing personal key (create one from the Neon Console) in order to create new keys using the API"* | — | **Once-ever** |
| Further personal API keys | Yes — `POST /api_keys` | personal | — |
| Organization API keys | Yes — `POST /organizations/{org_id}/api_keys`, but **an org key cannot create one**; *"Create an organization API key — Personal API Key ✅ \| Organization API Key ❌"* | personal **admin** key | — |
| Project-scoped API keys | Yes, same constraint (org admin only) | personal admin key | — |
| **Create a project from scratch** (ADR 0003's decision) | Yes — `POST /projects` | **personal key (with `org_id`) or organization key.** A project-scoped key **cannot**: *"Cannot perform organization-related actions or create new projects"* | — |
| **EU region selection** | Yes — `region_id` on `POST /projects`; `aws-eu-central-1` (Frankfurt) and `aws-eu-west-2` (London) are current | project-creating key | — |
| Postgres version | Yes — `pg_version` (14–18) | project-creating key | — |
| Branch per stage (`Neon.Branch`) | Yes — `POST /projects/{id}/branches` | org or project-scoped key | — |
| Drizzle migrations at deploy | Yes — applied over the branch's `connectionUri` (plain Postgres, not the control API) | none — needs the connection string | — |
| Project deletion / `alchemy destroy` | Yes for org keys; a project-scoped key *"cannot delete the project it is associated with"* | org key | — |
| Member/invite management, project transfer | `POST` exists but org keys are rejected — personal admin key required | personal admin key | — |

**Which key kind to issue** (this is what [#32](https://github.com/apshenichniy/praximo/issues/32) needs): an **organization API key**. It can create the project, branches, and everything downstream; it needs no `org_id` plumbing because *"organization API keys automatically scope all requests to your organization"*; and it is not tied to a human account that could leave. A project-scoped key is *not* sufficient — it cannot create the project in the first place, and cannot destroy it. The org key must itself be minted with a **personal admin key** (or from the console).

## Recommended token/key set for the root `.env`

```dotenv
# --- Cloudflare (Alchemy provider auth) ---
CLOUDFLARE_ACCOUNT_ID=<account id>
CLOUDFLARE_API_TOKEN=<account-owned token, permissions below>

# --- Neon (Alchemy provider auth) ---
NEON_API_KEY=<organization API key>
```

Three variables. `CLOUDFLARE_EMAIL` / `CLOUDFLARE_API_KEY` (Global API Key) are **not** needed and should not be present.

These are the same three ADR 0003 already names as the CI secrets alongside `ENV_FILE`, which is consistent — no fourth credential is required.

### `CLOUDFLARE_API_TOKEN` — permission set

An **account-owned** token (`cfat_` prefix; durable, not tied to a human) with two policies:

**Policy 1 — account resource `com.cloudflare.api.account.<account_id>: "*"`**

| Permission | Why |
|---|---|
| Workers Scripts Edit | Workers, service bindings, Durable Objects, Workflows, cron triggers, custom domains |
| Workers R2 Storage Edit | the shared R2 bucket (incl. `jurisdiction: "eu"`) |
| **Account Secrets Store Edit** | Alchemy's `Cloudflare.state()` bearer token; also required to *bind* any Secrets Store secret to a Worker |
| AI Gateway Edit | `Cloudflare.AI.Gateway`, provider keys, spend limits |
| Account Settings Read | account lookup; present in Cloudflare's own *Edit Cloudflare Workers* template |
| **Email Sending Edit** (`Email Sending Write`) | the `mail.praximo.io` sending subdomain and its auto-provisioned DKIM/SPF/return-path records |
| Email Routing Addresses Edit | verified destination addresses (only needed pre-onboarding — droppable once `mail.praximo.io` is live) |
| Workers Tail Read | `alchemy dev` / log tailing. Optional |
| Queues Edit | **only when Queues actually land** (ADR 0003 declares zero in MVP) |

**Policy 2 — zone resource, the `praximo.io` zone only**

| Permission | Why |
|---|---|
| Workers Routes Edit | `api.praximo.io/*` path routes |
| DNS Write | the proxied `AAAA 100::` record and any future records |
| Zone Read | zone lookup by `zoneName`; required by custom domains |

**Deliberately omitted**: `Workers KV Storage Edit` (ADR 0003 uses a DO+SQLite state store, not KV — Alchemy's tutorial includes it out of habit), `D1 Write`, `Pages Write`, `Billing Edit`, and anything user-scoped.

### Deploy token vs CI token

They can and should differ, and Alchemy supports the split natively:

- **CI token** = exactly the set above, account-owned, minted once by `Cloudflare.ApiToken.AccountApiToken` from a one-shot `stacks/github.ts` and pushed straight into a GitHub secret (`GitHub.Secret`) so the value never touches a shell. ADR 0003's `gh secret set` step can be replaced by this.
- **Dev token** = the same set, or narrower if a developer never needs to touch DNS.
- **Admin credential** = a *separate*, non-`.env` credential held under an Alchemy `--profile admin`, carrying only `User > API Tokens > Write`. It exists solely to mint the other two. Alchemy's docs are blunt about it: *"Treat it like root. Do not use it for everyday `alchemy deploy` runs."* Keep it out of the root `.env` and out of CI.

## Manual operations ADR 0003's principle must carve out

The principle is **"the agent does all devops; the human only supplies a secrets file."** These are the operations that produce or precede that secrets file, plus one recurring escape hatch. Everything not on this list is agent-operable.

**Once-ever, Cloudflare** — all in the dashboard, all before the agent has credentials:

0. **Complete the R2 checkout flow** (Storage & databases → R2 → Overview). A *separate* entitlement from Workers Paid, and a hard blocker: `POST /accounts/{id}/r2/buckets` fails until it is done. This is the step most likely to be missed, because it surfaces only as an entitlement error mid-deploy.
1. **Subscribe the account to Workers Paid** ($5/mo) and attach a payment method. Required for Email Sending's included quota and for the plan's CPU/memory limits.
2. **Create the bootstrap API token** using the **Create Additional Tokens** template. Structural: `API Tokens::Edit` is not offered by the custom token builder or any other template. Everything downstream — including the CI token — can then be minted by API.
3. **Grant Super Administrator** to the identity that will create account-owned tokens (or accept user-owned tokens instead, at the cost of durability).
4. *(pre-existing, listed for the runbook)* **Zone `praximo.io` on Cloudflare with nameservers delegated at the registrar.** ADR 0003 already assumes this; delegation is registrar-side and outside any Cloudflare API.
5. **Onboard the apex domain to Email Sending** — *only if* the project ever needs to send from `@praximo.io` rather than `@mail.praximo.io`. The current design does not, so this should stay un-done.

**Once-ever, Neon** — all in the console:

6. **Create the Neon organization** and pick its plan (Free is fine). No `POST /organizations` exists.
7. **Create the first personal API key**, then use it to mint the **organization API key** that goes in `.env`. The org key cannot create itself.

**Recurring:**

8. **Email Sending daily-quota increase** — a Google Form, human-completed, Cloudflare replies out of band. Only triggered if send volume outgrows the auto-scaling quota; MVP volume is tens to low hundreds of emails/month, so this should stay theoretical.
9. **Destination-address verification clicks** — each verified destination address needs a link clicked in a confirmation email. Applies only *before* a sending domain is onboarded; afterwards, sends go to any recipient. In practice: zero clicks once `mail.praximo.io` exists.
10. **Delete orphaned Advanced Certificates** after removing a Workers custom domain — Cloudflare does not clean them up automatically. Teardown-only; triggered by removing or renaming `app.praximo.io`, never by a normal deploy.
11. **Neon organization member management** — inviting members, removing members and transferring projects *"require a personal API key from an organization admin and cannot be performed using organization API keys"* ([orgs API](https://neon.com/docs/manage/orgs-api)). Off the deploy path; relevant only when a second human joins.

Nothing else in ADR 0003's surface area requires a human.

## Consequences for ADR 0003

Two findings contradict assumptions in the ADR and should be reflected when it is next revised or when [#13](https://github.com/apshenichniy/praximo/issues/13) is implemented:

1. **"No Cloudflare Secrets Store" is not quite true.** ADR 0003 says *"No Cloudflare Secrets Store resources: `.env` is already the source of truth."* That holds for *our* secrets, but Alchemy's `Cloudflare.state()` store keeps its own bearer token in the account-wide Secrets Store (`Cloudflare/StateStore/Token.ts`: *"the account-wide Cloudflare Secrets Store"*). The deploy token therefore **must** carry `Account Secrets Store Edit`. This is a permission-set fact, not a design change — we still declare no Secrets Store resources of our own.

2. **`Neon.Project` defaults to `aws-us-east-1`.** `packages/alchemy/src/Neon/Project.ts` has `const DEFAULT_REGION: NeonRegion = "aws-us-east-1"`. Given the project's EU-where-possible posture ([privacy-retention](../spec/privacy-retention.md), [#6](https://github.com/apshenichniy/praximo/issues/6)), the stack **must** pass `region: "aws-eu-central-1"` explicitly. Changing it later is a replacement, not an update (the resource diffs on `region`), so getting it right on the first `alchemy deploy` matters. Note also that Alchemy's `NeonRegion` union still lists `azure-eastus2` / `azure-westus3` / `azure-gwc`, which Neon has since **deprecated for new projects** — do not use them.

3. Minor: R2's EU residency is a first-class `jurisdiction: "eu"` field on bucket creation, so [#6](https://github.com/apshenichniy/praximo/issues/6)'s residency requirement is fully IaC-expressible with no manual step.

## Claims not verified against a primary source

- ~~**Email Sending subdomain — required token permission.**~~ **Resolved**: `Email Sending Read` / `Email Sending Write` do exist as permission groups (Alchemy's vendored catalogue, `com.cloudflare.api.account`). The Email *Routing* groups are the wrong product. One residual unknown remains — whether an account-scoped grant authorizes the zone-scoped subdomain endpoint. See [Permission-group names](#permission-group-names-verified-against-alchemys-vendored-catalogue).
- ~~**`Secrets Store Write` as a permission-group name.**~~ **Resolved**: the catalogue spells them `Secrets Store Read` / `Secrets Store Write` (account scope); the dashboard label is *Account Secrets Store Read/Edit*. Same grant.
- ~~**`Account > API Tokens > Write`.**~~ **Resolved**: `Account API Tokens Read` / `Account API Tokens Write` exist at account scope. Minting account-owned tokens needs the account-scoped grant, not a user-scoped one; **Super Administrator** applies to the human doing the initial dashboard mint.
- **Email Sending per-account enablement.** No beta gate, waitlist, or dashboard toggle is documented anywhere ([public-beta changelog](https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/), [subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/), [limits](https://developers.cloudflare.com/email-service/platform/limits/)). But the [setup guide](https://developers.cloudflare.com/email-service/get-started/send-emails/) documents only a dashboard "Onboard Domain" flow, which *may* perform an account-level first-use enablement that `POST …/subdomains` does not. **This remains the single most likely place for a hidden dashboard click** — exercise the Alchemy resource before depending on it.
- **R2 entitlement has no API path.** The [get-started page](https://developers.cloudflare.com/r2/get-started/) states the dashboard checkout flow unconditionally; whether `POST /accounts/{id}/subscriptions` could also add R2 is undocumented. Assumed not.
- **Workers Paid self-serve subscription by API.** `POST /accounts/{id}/subscriptions` and `Billing Edit` both exist, but Cloudflare documents the subscriptions API in a Tenant/Enterprise context and never documents self-serve Workers Paid signup via API. Treated as a dashboard step above; not disproven.
- **AI Gateway BYOK provider keys.** Alchemy ships `AI/ProviderKey.ts` and `AI/GatewayProvider.ts`, and the AI Gateway REST API exposes gateway create/update and custom providers. That provider *keys* specifically are settable through the public REST surface (rather than only through Alchemy's use of a newer/undocumented endpoint) was not confirmed from Cloudflare's API reference.
- **workers.dev subdomain registration** for dev stages was not investigated; if the account has never claimed a `*.workers.dev` subdomain, a first-time claim may be a dashboard step.

## Sources

- Cloudflare — [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) · [API token templates](https://developers.cloudflare.com/fundamentals/api/reference/template/) · [Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) · [Create tokens via API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/) · [Account API tokens + compatibility matrix](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/) · [API rate limits](https://developers.cloudflare.com/fundamentals/api/reference/limits/)
- Cloudflare API reference — [Create Token](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/create/) · [R2 create bucket (`jurisdiction`, `locationHint`)](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/) · [Workers domains](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/) · [Cron trigger schedules](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/) · [Durable Objects namespaces](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/methods/list/) · [AI Gateway](https://developers.cloudflare.com/api/resources/ai_gateway/) · [Email Sending REST API](https://developers.cloudflare.com/api/resources/email_sending/) · [Account subscriptions](https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/)
- Cloudflare — [Secrets Store access control](https://developers.cloudflare.com/secrets-store/access-control/) · [Email Service: send emails](https://developers.cloudflare.com/email-service/get-started/send-emails/) · [Email Service: domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/) · [Email Service: limits](https://developers.cloudflare.com/email-service/platform/limits/) · [Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- Neon — [Manage API keys](https://neon.com/docs/manage/api-keys) · [Manage organizations using the Neon API](https://neon.com/docs/manage/orgs-api) · [Manage organizations](https://neon.com/docs/manage/orgs-manage) · [API reference](https://neon.com/docs/reference/api-reference) · [Regions](https://neon.com/docs/introduction/regions) · [Create project](https://api-docs.neon.tech/reference/createproject)
- Alchemy 2 source (`alchemy-run/alchemy@main`, commit `68df27e`, checked 2026-07-20): `packages/alchemy/src/Cloudflare/Credentials.ts`, `packages/alchemy/src/Cloudflare/StateStore/{Store,Token}.ts`, `packages/alchemy/src/Cloudflare/Email/SendingSubdomain.ts`, `packages/alchemy/src/Cloudflare/AI/{Gateway,GatewayProvider,ProviderKey}.ts`, `packages/alchemy/src/Neon/{Project,Credentials}.ts`, `website/src/content/docs/cloudflare/tutorial/part-5.mdx`
- Cloudflare — [R2 get started (subscription checkout)](https://developers.cloudflare.com/r2/get-started/) · [Durable Objects pricing (SQLite on Free plan)](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/) · [Create sending subdomain API](https://developers.cloudflare.com/api/resources/email_sending/subresources/subdomains/methods/create/) · [Email Sending subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/) · [Email Sending public-beta changelog](https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/) · [Create Zone](https://developers.cloudflare.com/api/resources/zones/methods/create/)
- Alchemy 2, second pass (`alchemy@2.0.0-beta.62`, local bun cache, read 2026-07-20): `src/Cloudflare/ApiToken/PermissionGroups.ts` (1,910-line vendored permission catalogue) · `src/Cloudflare/Auth/AuthProvider.ts` · `src/Cloudflare/R2/Bucket.ts` · generated API surfaces `@distilled.cloud/cloudflare@0.29.0` (`src/services/{email-sending,accounts,billing,workflows,queues,r2,durable-objects}.ts`) and `@distilled.cloud/neon@0.29.0` (`src/operations/*`, enumerated to establish the absence of a create-organization endpoint)
- Related repo research: [email-provider.md](email-provider.md)
