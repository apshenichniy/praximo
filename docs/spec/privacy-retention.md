# Privacy, Consent, and Retention — MVP Policy

MVP privacy posture: consent, retention, deletion, ownership, and data residency. Vocabulary follows [CONTEXT.md](../../CONTEXT.md); entity structure in [domain-model.md](domain-model.md). Decided in wayfinder ticket [#6](https://github.com/apshenichniy/praximo/issues/6).

## Posture and roles

- **GDPR-shaped, not GDPR-certified.** The system is designed around consent, minimization, deletion, and processor disclosure, but MVP carries no formal compliance program (no DPO, no audits).
- **Coach = data controller, platform = data processor.** Client requests — revocation, deletion — flow through the coach; the platform's job is to give the coach the tools to honor them.

## Consent

- **One standing Consent Grant**, captured at client onboarding (append-only, as modeled). Minimum friction: consent is asked once and never re-pushed. Two equal capture surfaces: the Telegram bot conversation and the **web acceptance page** ([#27](https://github.com/apshenichniy/praximo/issues/27)) — same text, same five elements, same atomic commit; the grant records which surface it was given through.
- **Google profile import** (optional, web acceptance page): with the client's explicit click, name, avatar, email, and the Google `sub` are captured from the Google profile; basic scopes only, the OAuth token is not stored. Disclosed in the privacy policy.
- **Pre-join notice, not a second consent.** The web room's pre-join screen shows a short notice ("this session is recorded and analyzed by AI for your coach"). Informational only — the join click is logged, no new grant is created.
- **Recording is unconditional.** No per-session opt-out, no in-room off switch — "session without recording" is out of MVP scope. A recording indicator is always visible in the web room. A client who declines recording is met off-platform (Zoom, Meet, …).
- **Revocation goes through the coach.** A "client revoked consent" action appends a revocation grant. Scheduling is blocked only **after revocation** (form disabled with a hint); the client remains as a contact. While consent is still *pending* (invite outstanding), scheduling is allowed — the client cannot join before accepting, because the join link is delivered over the client's channel, which exists only after acceptance; the client's join link is not exposed to the coach until consent is granted ([client-onboarding-auth.md](client-onboarding-auth.md)). Existing data is untouched — deletion is a separate, explicit action. Self-service revocation (e.g. a bot command) is post-MVP.
- **Coach side:** the coach accepts the terms of service and data processing at first Mini App login; the acceptance fact and text version are recorded on Member. No Consent Grant for coaches — it's part of the ToS.

### Consent text — required elements

The copy itself lives in [privacy-copy.md](privacy-copy.md); texts are written in the **client's language** (en/uk/ru), and the text version is recorded on the Consent Grant. The text must state:

1. Session audio is recorded.
2. Recordings are analyzed by AI; the results go only to the client's coach.
3. Audio is kept up to 30 days after transcription; transcripts and analysis results are kept until the coach deletes them.
4. Processing happens in the EU, except AI analysis in the US (LLM providers; requests transit Cloudflare AI Gateway with logging).
5. Consent can be revoked and deletion requested through the coach.

The privacy policy additionally discloses that deleted data may persist in backups for up to 7 days.

## Retention

| Data | Retention |
|---|---|
| Audio tracks (R2) | Auto-deleted **30 days** after the session's Transcript is successfully generated. R2 objects removed; Recording/Track rows keep metadata plus a deleted-by-retention fact. Not configurable in MVP. |
| Track transcripts, Transcript (R2) | Until deleted by the coach. |
| Artifacts | Until deleted by the coach. |
| Neon backups | PITR window **7 days**; deleted rows persist at most that long. |
| R2 versioning | Off — object deletion is final. |
| AI Gateway request logs | Logging stays **on** (observability); part of the disclosed US transfer. |
| Deepgram | EU endpoint with `mip_opt_out=true` — zero retention at the STT provider. |

## Deletion

- **Granularity:** the coach can delete (a) a **session's data** — recording, transcripts, artifacts; the session row stays in the schedule — or (b) a **client entirely** — full cascade including sessions.
- **Semantics:** hard delete. DB rows are physically removed, no tombstones; R2 objects are removed by an async cleanup job; a session mid-pipeline has its run cancelled first. Confirmation dialog, no undo.
- **Workspace offboarding** (coach leaves the platform): manual runbook, same as onboarding. No self-service.

## Export and ownership

- The coach owns their practice's data; the platform processes it.
- **No formal export in MVP.** Artifacts are already delivered via the bot; anything else is handled manually on request. A client-data export archive is post-MVP.

## Data residency

All first-party data stays in the EU:

- **Neon**: `aws-eu-central-1` (Frankfurt)
- **R2**: `jurisdiction=EU`
- **LiveKit**: self-hosted in the EU
- **Deepgram**: EU endpoint `api.eu.deepgram.com` (GA since Dec 2025, no surcharge) with `mip_opt_out=true` — full STT processing inside the EU, zero retention (forgoes the MIP discount; negligible at MVP volumes)
- **Email (invites and reminders)**: Cloudflare Email Service — **no new subprocessor** (Cloudflare already processes Workers traffic, R2, and AI Gateway logs); no documented region guarantee for email metadata, accepted per research [#26](https://github.com/apshenichniy/praximo/issues/26)

The **only US transfer** is LLM analysis: LLM providers under no-training API terms, via Cloudflare AI Gateway (request logs retained for observability). Disclosed in the consent text and privacy policy.

## Documents

Two pages served by the `web` Worker as ordinary app routes — the privacy policy and the coach terms — linked from the client consent and the coach ToS acceptance. App routes rather than static pages on praximo.io so a Mini App link opens in place: `openLink` would eject the coach from the Mini App in the middle of accepting. Their canonical URLs and versions are exported from one module, so the client consent and the Acceptance Page consume them instead of re-deciding. Copy for both, plus the client consent and the pre-join notice, is in [privacy-copy.md](privacy-copy.md); the coach terms carry the data-processing agreement as a section rather than as a separate document. The operator / legal-entity name and the other legal placeholders stay open until the entity is decided.
