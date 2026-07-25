# ADR 0006: Coach authentication in MVP — Ed25519 init data, no session, Better Auth deferred

- **Status:** accepted
- **Date:** 2026-07-25
- **Decided in:** implementation planning for [#54](https://github.com/apshenichniy/praximo/issues/54); amends the coach half of wayfinder tickets [#5](https://github.com/apshenichniy/praximo/issues/5) and [#14](https://github.com/apshenichniy/praximo/issues/14)

## Context

The MVP specification named a first-party Better-Auth `telegram-mini-app` plugin as the coach's sign-in mechanism, with the Bearer plugin as a fallback for Telegram Web's iframe and the organization plugin carrying workspace membership ([client-onboarding-auth.md](../spec/client-onboarding-auth.md), research ticket #5).

Two facts, both established after that decision, put it in question at implementation time.

**The admin surface already ships the alternative.** `ManagerInitData.verify` validates `initData` on every server request against the platform-owned manager-bot token, with a 24-hour `auth_date` window and no server session at all. It has been in production since the admin Mini App landed.

**Both MVP actors are Telegram-only.** The coach reaches the product exclusively through their own bot's Mini App; the client has no account by design (tokenized links only); the web room runs on per-(session, role) join links. There is no MVP actor without `initData`.

Adopting Better Auth for the coach would therefore introduce a second, session-based identity mechanism for the *other* Telegram-only actor — with its own `user` / `session` / `account` tables (the first colliding by name with our coaching `session`, the organization plugin's `member` colliding with our own), its own `member.user_id` lifecycle problem (our `member` row is created at workspace creation, before any person is known), and a second invite concept beside `coach_onboarding_invite`. None of it is exercised by anything MVP ships.

## Decision

**The coach authenticates by per-launch Ed25519 `initData` verification, with no server session. Better Auth is deferred to post-MVP and arrives with the web app.**

Three properties are required of the MVP implementation, because they are what make the deferral cheap to reverse:

1. **The credential travels on the request** — attached as headers by one client module, read from the request server-side. It is never a server-function argument and never part of a query key. A Better Auth cookie later replaces that one module and nothing else. Both the coach and the admin tree follow this.
2. **The launch is self-identifying.** The coach bot's Mini App URL carries `?b=<telegramBotId>`, set per bot at provisioning with that bot's own token. Verification runs against that candidate before any database access; the signature binds the bot id, so a wrong or borrowed value simply fails. No authorization decision is made from an unverified key.
3. **`member.credentials_valid_from`** is the revocation floor, compared against `auth_date`. It is the hook Better Auth's session revocation maps onto later, and without it deferring sessions would also defer revocation silently.

**Windows.** Reads accept a 24-hour `auth_date`, matching the admin path and the fact that Telegram never refreshes `initData` after launch. State-changing operations require **15 minutes**: the terms-acceptance screen is by construction the first screen of a fresh launch, so a short window costs an honest coach nothing while removing the bulk of the replay exposure on a legally operative first write.

**The scheme is Ed25519 only.** `signature` is required; `hash` is never consulted. A coach owns their bot in @BotFather and can read its token; under the HMAC scheme that token forges `initData` for any Telegram user id, under Ed25519 it forges nothing. No leniency for older clients may reintroduce `hash`.

**The trust anchor is not a deployment value.** `TELEGRAM_ENV` selects between Telegram's two public keys, both hardcoded in source. A third branch carries a local development key and is guarded so it folds out of production builds; local development mints real signed `initData` and runs the real verifier, so no authentication-bypass path exists in the codebase.

## Consequences

**Accepted residual: a captured `initData` is a bearer credential for its window,** and there is no session to revoke. The admin path already carries this residual, but its blast radius does not transfer — the admin set is one or two operators, the coach set is every customer, and a coach workspace holds client recordings and transcripts. `credentials_valid_from` and the 15-minute window on state changes are the mitigations; workspace deletion is the only writer of the floor in MVP.

**Terms versioning records the terms only.** `member.terms_version` carries a content-derived version of the coach terms. A privacy-policy revision is deliberately unrecorded in MVP. A version bump does not force re-acceptance — the gate is `terms_accepted_at`, not version equality — because no re-acceptance flow is built and the legal placeholders guarantee at least one text change before launch.

**Adoption cost, stated honestly: roughly one slice, not one file.** The seam abstracts *verification*; Better Auth replaces *transport*, *revocation* and *session lifetime* as well. Adoption means: the schema and a backfill (one `auth_user` + one `auth_account` per member, keyed on `member.telegram_user_id`, which this ADR's slice makes unique); mounting the auth handler; config and secrets; the cookie/Bearer split for Telegram Web's iframe; the custom `telegram-mini-app` plugin; restoring SSR on coach routes that MVP renders client-only; lighting up the web room's dormant Better-Auth gate branch ([client-onboarding-auth.md](../spec/client-onboarding-auth.md) §Web-room access); and deciding whether the admin path converges onto it or the platform keeps two mechanisms. Property 1 above is what keeps the transport line off that list.

**Table naming at adoption.** Better Auth's tables are prefixed `auth_*` — our `session` is a coaching session and our `member` is a workspace seat, and neither yields its name. Mapping Better Auth's models onto existing tables, if ever wanted, is `modelName` configuration rather than a migration.

**Out of scope for this ADR.** Impersonation is a real post-MVP need but is not documented here: it is absent from the admin surface's operation set and from the coach terms of service the coach accepts, and it sits in tension with "coach = controller, platform = processor". The slice that ships it documents it, and amends the terms.

## Alternatives considered

**Adopt Better Auth now with the organization plugin** (`organization → workspace`, `member → member`). Rejected: it forces a placeholder `auth_user` for a workspace whose coach is not yet known, adds a second invite concept, and brings an access-control layer nothing in MVP uses. It also enshrines *organization* as a synonym for Workspace, which [CONTEXT.md](../../CONTEXT.md) explicitly bans.

**Adopt Better Auth core without the organization plugin.** Closer, and the shape adoption will eventually take. Rejected for MVP because the only thing it adds over this ADR is session management, and sessions buy nothing for an actor whose credential is minted by Telegram on every launch.

**Keep no seam at all** — verify `initData` inline wherever it is needed. Rejected: that is what makes a later migration expensive, and it is precisely the shape properties 1–3 exist to avoid.
