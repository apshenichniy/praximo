# Research: email provider — Cloudflare Email Service vs Resend

- **Date**: 2026-07-20
- **Ticket**: [#26](https://github.com/apshenichniy/praximo/issues/26) (blocks [#27](https://github.com/apshenichniy/praximo/issues/27))
- **Question**: which email-sending provider should the MVP email channel (invites + session reminders) use — Cloudflare Email Service or Resend?

## Recommendation

**Use Cloudflare Email Service (Email Sending, public beta).** At MVP volume it is effectively free on the Workers Paid plan we already need, it adds **no new vendor and no new US subprocessor** to the privacy story, the domain setup (SPF/DKIM/DMARC/return-path on `praximo.io`) is provisioned **automatically and entirely from the Alchemy 2 stack** via first-class `Cloudflare.Email.*` resources — including a typed Effect send client that matches our Effect 4 codebase — and bounce/complaint suppression is automatic with zero code. The one real cost is "beta" status; this stack already deliberately carries three betas (TS 7, Effect 4, Alchemy 2), and the send path is isolated behind a service interface so a swap to Resend stays a one-module change.

Resend is the fallback, not the pick: excellent DX and a sufficient free tier (3,000/month, 100/day), but it is a **new vendor whose account data — email metadata, logs, API records — is stored in the US regardless of the `eu-west-1` sending region**, its domain DNS setup is manual (no Alchemy provider), and bounce visibility requires standing up a webhook endpoint.

## Fact table

| Fact | Cloudflare Email Service | Resend |
|---|---|---|
| Status (2026-07) | Email Sending in **public beta** since 2026-04-16 ([changelog](https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/)); Email Routing GA | GA product |
| Plan requirement | Workers **Paid** plan ($5/mo — already required by this stack) | None; free tier standalone |
| Included volume / price | **3,000 emails/mo included**, then $0.35 per 1,000; sends to verified destination addresses are free ([pricing](https://developers.cloudflare.com/email-service/platform/pricing/)) | Free: 3,000/mo, **100/day cap**, 1 domain; Pro $20/mo for 50k ([pricing](https://resend.com/pricing)) |
| Workers integration | Native **`send_email` binding**: `env.EMAIL.send({...})`; also REST API and SMTP (port 465) ([docs](https://developers.cloudflare.com/email-service/get-started/send-emails/)) | REST API; `resend-node` SDK is fetch-based and runs on workerd ([official Workers guide](https://resend.com/docs/send-with-cloudflare-workers)) |
| Sending limits | 50 recipients/email, 5 MiB message; new accounts start with a conservative daily quota that auto-scales with deliverability ([limits](https://developers.cloudflare.com/email-service/platform/limits/)) | 100/day on free; higher on paid; rate limit 2 req/s (default) |
| EU data residency | Not documented for Email Service; global Cloudflare network, US parent. **No new subprocessor** — Cloudflare already processes our traffic and AI Gateway logs | **`eu-west-1` sending region (Ireland) exists, but all account data — metadata, logs, API records — is stored in the US** regardless of region ([regions doc](https://resend.com/docs/dashboard/domains/regions), [GDPR page](https://resend.com/security/gdpr) — DPA + SCCs). A new US subprocessor |
| SPF/DKIM/DMARC for `praximo.io` | **Auto-provisioned** on zone onboarding: SPF + DKIM TXT, `_dmarc` TXT, bounce/return-path MX on a `cf-bounce` subdomain — automatic for zones on Cloudflare DNS ([setup docs](https://developers.cloudflare.com/email-service/get-started/send-emails/)) | Resend generates records (DKIM, SPF on send subdomain, return-path MX); must be copied into the Cloudflare zone manually or via bespoke glue |
| Drivable from Alchemy 2 | **Yes, first-class**: `Cloudflare.Email.SendingSubdomain` (provisions DKIM/SPF/return-path; `enabled` flips once records validate), `Cloudflare.Email.SendEmail` (binding descriptor with `allowedSenderAddresses`), plus a typed **Effect `Send` client** (`Cloudflare.Email.Send`, typed `SendEmailError`) — verified in `alchemy-run/alchemy@main` (`packages/alchemy/src/Cloudflare/Email/`, `examples/cloudflare-email/`) | **No Alchemy provider.** Domain creation via Resend dashboard/API; DNS records could be mirrored with `Cloudflare.DNS.Record` but values must be fetched out-of-band |
| React Email | Documented pattern: render with `@react-email/render` (`render`, `pretty`, `toPlainText`) **inside the Worker**, pass HTML to the binding ([launch post](https://blog.cloudflare.com/email-service/)) | Native: SDK accepts a `react` element directly; same in-Worker render caveats apply |
| Bounce/complaint handling | **Automatic**: hard bounces and postmaster spam complaints go to an account **suppression list**; soft bounces retried with backoff; sends to suppressed addresses blocked ([suppressions](https://developers.cloudflare.com/email-service/concepts/suppressions/), [deliverability](https://developers.cloudflare.com/email-service/concepts/deliverability/)). Optional: **event subscriptions to Queues** (`message.delivered/deferred/bounced/failed/rejected/complained`, [changelog 2026-07-15](https://developers.cloudflare.com/changelog/post/2026-07-15-event-subscriptions/)) | Webhooks (`email.bounced`, `email.complained`, `email.delivered`, ... — [event types](https://resend.com/docs/dashboard/webhooks/event-types)); requires hosting + verifying a webhook endpoint for visibility |
| Observability | Email Logs + analytics in dashboard ([logs](https://developers.cloudflare.com/email-service/observability/logs/)) | Dashboard logs, 30-day retention on free tier |

## Detail

### Cloudflare Email Service availability

Announced as private beta at Birthday Week 2025 ([blog](https://blog.cloudflare.com/email-service/)); **Email Sending graduated to public beta on 2026-04-16** ([changelog](https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/), [blog](https://blog.cloudflare.com/email-for-agents/)) — anyone on Workers Paid can enable it, no waitlist. It supports HTML, plain text, attachments, inline images, and custom headers, and now sits with Email Routing under one "Email Service" umbrella ([overview](https://developers.cloudflare.com/email-service/)). Still labeled Beta in the docs; pricing is published (see table), which suggests the packaging is settled.

### Volume fit

MVP volume is invites + session reminders for a handful of coaches' clients — realistically tens to low hundreds of emails per month. Both providers' free allowances (3,000/mo) exceed this by an order of magnitude. Cloudflare's allowance rides on the Workers Paid subscription the project already pays for; Resend's free tier's 100/day cap is irrelevant at this volume. **Price is a non-factor; integration and privacy decide.**

### EU residency

Neither provider offers a hard EU-residency guarantee for email metadata:

- **Resend** is explicit: choosing `eu-west-1` only controls where mail is dispatched from (Ireland); *"account data, including email metadata, logs, and API records, is stored in the United States"* ([regions](https://resend.com/docs/dashboard/domains/regions)). GDPR posture is DPA + SCCs ([gdpr](https://resend.com/security/gdpr)).
- **Cloudflare** documents no region controls for Email Service; processing happens on its global network under the existing Cloudflare DPA.

Given [privacy-retention.md](../spec/privacy-retention.md) ("EU where possible", with a documented US carve-out for AI providers via AI Gateway), the deciding privacy argument is **subprocessor count, not region**: Cloudflare is already an unavoidable processor for this stack (Workers, R2 with `jurisdiction=EU`, AI Gateway logs); adding Resend would introduce a second US company holding recipient addresses and subject lines. Email content (names, session times) is modest but personal. Cloudflare Email Service keeps it inside the processor we already disclose.

### Domain setup and IaC

Cloudflare's onboarding for a zone already on Cloudflare DNS (as `praximo.io` is) **creates all records automatically**: SPF TXT, DKIM TXT, `_dmarc` TXT, and MX/return-path on a `cf-bounce` subdomain ([setup](https://developers.cloudflare.com/email-service/get-started/send-emails/)).

Alchemy 2 support was verified directly against `alchemy-run/alchemy@main` (per ADR 0003's practice, since beta docs lag):

- `Cloudflare.Email.SendingSubdomain` — registers a sending subdomain on a zone (e.g. `mail.praximo.io`); *"creating the subdomain provisions DKIM, SPF, and return-path configuration; for zones on Cloudflare DNS the required DNS records are created automatically"*, exposes `enabled`, `dkimSelector`, `returnPathDomain`.
- `Cloudflare.Email.SendEmail` — the `send_email` binding descriptor, with optional `allowedSenderAddresses` to pin the Worker to approved `from:` addresses.
- `Cloudflare.Email.Send` — a typed **Effect service** over the runtime binding (`send(message): Effect<EmailSendResult, SendEmailError>`), i.e. the provider plugs into our Effect 4 service-module style with typed errors out of the box.
- A complete working example exists at `examples/cloudflare-email/`.

For Resend, no Alchemy provider exists (checked `packages/alchemy/src/` at `main`); domain verification and DNS record values would be a manual dashboard step or custom API glue — against ADR 0003's guiding principle that *the agent does all devops*.

### Templating (React Email, EN/UK/RU)

Cloudflare's own launch material demonstrates rendering React Email **inside the Worker**: import `render`/`pretty`/`toPlainText` from `@react-email/render`, render the component to HTML, pass to `env.EMAIL.send()` ([blog](https://blog.cloudflare.com/email-service/)). Historic workerd incompatibilities ([react-email#1508](https://github.com/resend/react-email/issues/1508), [#1054](https://github.com/resend/react-email/issues/1054)) concerned older `render()` builds relying on Node SSR APIs; current guidance plus `nodejs_compat` makes in-Worker rendering the default plan, with **build-time prerendering to parameterized HTML strings as the escape hatch** if bundle size or runtime issues appear.

Trilingual is a template-organization concern, not a provider one: one React Email component per template (invite, reminder) taking a `locale: "en" | "uk" | "ru"` prop (or three sibling components sharing layout), with strings in per-locale message maps in the same package. Subject lines localize alongside. Nothing here differentiates the providers — Resend's `react` parameter is marginally nicer sugar, Cloudflare needs one explicit `render()` call.

### Bounce/complaint handling (MVP-minimal)

- **Cloudflare**: nothing to build. Hard bounces are auto-added to the account suppression list; postmaster feedback loops feed complaints into the same list; soft bounces are retried with exponential backoff; sends to suppressed addresses are blocked before dispatch ([suppressions](https://developers.cloudflare.com/email-service/concepts/suppressions/), [lifecycle](https://developers.cloudflare.com/email-service/concepts/email-lifecycle/)). Since 2026-07-15, delivery events (`message.bounced`, `message.complained`, ...) can be **subscribed to a Queue** ([changelog](https://developers.cloudflare.com/changelog/post/2026-07-15-event-subscriptions/)) — a clean post-MVP path to flag a client's email as invalid in Postgres.
- **Resend**: bounce/complaint visibility means registering a webhook (`email.bounced`, `email.complained`), exposing and verifying an endpoint on `api.praximo.io`, and wiring it to state — more moving parts for the same MVP outcome.

### Risks of the recommendation

1. **Beta product.** Mitigation: the send path lives behind one Effect service interface; Resend (or SMTP to any provider) is a drop-in replacement at the module boundary. Accepted the same way ADR 0003 accepted the Alchemy 2 beta.
2. **Conservative starting daily quota** on new accounts ([limits](https://developers.cloudflare.com/email-service/platform/limits/)). At our volume this is unlikely to bind; a limit-increase form exists.
3. **Deliverability track record** is younger than SES-backed Resend. Suppression, DKIM/SPF/DMARC, and a dedicated return-path are handled; monitor Email Logs during the first coach onboardings.

## Integration sketch

```ts
// alchemy.run.ts (root stack) — email infra
const mail = yield* Cloudflare.Email.SendingSubdomain("Mail", {
  zoneId: praximoZoneId,           // pre-existing praximo.io zone (ADR 0003)
  name: "mail.praximo.io",         // isolates sending reputation from the apex
});

// apps/web/src (invites) and apps/pipeline/src (reminders) — binding on each Worker
const Email = Cloudflare.Email.SendEmail("Email", {
  allowedSenderAddresses: ["no-reply@mail.praximo.io"],
});
// bound into the Worker declaration via Cloudflare.Worker.bind(..., { Email })
```

```ts
// packages/messaging (or similar) — module-namespace service per AGENTS.md
// EmailChannel.send wraps Cloudflare.Email.Send (typed Effect client from Alchemy):
//   1. pick template component + locale (en | uk | ru) from the client record
//   2. html = await render(<Invite locale={locale} {...props} />); text = toPlainText(html)
//   3. yield* send({ from: "no-reply@mail.praximo.io", to, subject: subjects[locale], html, text })
// Errors: SendEmailError surfaces as a typed channel error; retries via Effect.Schedule.
```

- **Templates**: React Email components in the messaging package, one per template with a `locale` prop; rendered in-Worker via `@react-email/render`; prerender at build time only if workerd/bundle issues force it.
- **Bounces (MVP)**: rely on automatic suppression; do nothing else.
- **Post-MVP**: subscribe Email Sending events to a Queue consumed by the pipeline Worker to mark bouncing client addresses in Postgres and surface them to the coach.
- **Fallback**: if the beta disappoints, implement the same `EmailChannel` interface over Resend's REST API (`eu-west-1` region), add its DNS records to the zone via `Cloudflare.DNS.Record`, and document the added US subprocessor in the privacy spec.

## Sources

- Cloudflare: [Email Service overview](https://developers.cloudflare.com/email-service/) · [public beta changelog](https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/) · [send-emails setup](https://developers.cloudflare.com/email-service/get-started/send-emails/) · [pricing](https://developers.cloudflare.com/email-service/platform/pricing/) · [limits](https://developers.cloudflare.com/email-service/platform/limits/) · [suppressions](https://developers.cloudflare.com/email-service/concepts/suppressions/) · [deliverability](https://developers.cloudflare.com/email-service/concepts/deliverability/) · [event subscriptions changelog](https://developers.cloudflare.com/changelog/post/2026-07-15-event-subscriptions/) · [private-beta blog (React Email example)](https://blog.cloudflare.com/email-service/) · [public-beta blog](https://blog.cloudflare.com/email-for-agents/)
- Resend: [pricing](https://resend.com/pricing) · [regions / data residency](https://resend.com/docs/dashboard/domains/regions) · [GDPR](https://resend.com/security/gdpr) · [Cloudflare Workers guide](https://resend.com/docs/send-with-cloudflare-workers) · [webhook event types](https://resend.com/docs/dashboard/webhooks/event-types)
- Alchemy 2 source (`alchemy-run/alchemy@main`, checked 2026-07-20): `packages/alchemy/src/Cloudflare/Email/{SendingSubdomain,SendEmail,Send,Routing,Address,Rule}.ts`, `examples/cloudflare-email/`
- React Email workerd caveats: [react-email#1508](https://github.com/resend/react-email/issues/1508) · [react-email#1054](https://github.com/resend/react-email/issues/1054)
