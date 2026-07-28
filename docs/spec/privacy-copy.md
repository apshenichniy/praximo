# Consent and Policy Copy — MVP

The four privacy-related texts: client consent, web-room pre-join notice, privacy policy, coach terms of service. Policy substance lives in [privacy-retention.md](privacy-retention.md); this document holds the **copy**. Drafted and accepted in wayfinder ticket [#16](https://github.com/apshenichniy/praximo/issues/16); prototype on branch `prototype/privacy-copy` (`prototypes/privacy-copy.html`).

**Status:** accepted as the implementation baseline. Final wording edits happen during implementation, not as a separate decision.

## Conventions

- **Register:** plain language, second-person formal (`ви` / `вы`). Short one-pagers for the policy and the terms — readable sections, named subprocessors, no legal jargon.
- **Coach gender is unknown to the system.** UK and RU copy must avoid verbs that agree with the coach's gender. Write `Щоб допомогти {coach} готуватися…`, never `Щоб {coach} могла…`. This constraint killed one pre-join variant (see below) and is the reason the consent button is `Даю згоду` / `Даю согласие` rather than `Погоджуюсь(-лася)` / `Согласен(-на)`.
- **Placeholders** stay open until the legal-entity decision deferred in [#6](https://github.com/apshenichniy/praximo/issues/6): operator legal name and address, jurisdiction, liability cap, pricing terms, contact email, and the named list of LLM providers.
- **Translations:** consent and pre-join notice ship in EN / UK / RU. The privacy policy and coach terms are written in EN and translated during implementation, once the English is stable.
- **Versioning:** every text carries a version; the version the client agreed to is recorded on the Consent Grant, and the coach's acceptance version on Member.

## 1. Client consent

Shown at onboarding on both capture surfaces — the Telegram bot conversation and the web acceptance page — with identical text. Covers the five required elements from [privacy-retention.md § Consent text](privacy-retention.md#consent-text--required-elements) in order.

### EN

> **One thing to agree to**
>
> To help {coach} prepare for your sessions, Praximo records and analyses them. Here is exactly what that means:
>
> 1. Your session audio is recorded.
> 2. The recordings are analysed by AI. The results go only to {coach} — nobody else sees them.
> 3. Audio is deleted 30 days after it is transcribed. Transcripts and analysis results are kept until {coach} deletes them.
> 4. Everything is processed in the EU, except the AI analysis, which runs in the US. Those requests pass through Cloudflare AI Gateway, which keeps a log of them.
> 5. You can withdraw this consent, or ask for your data to be deleted, at any time — just tell {coach}.
>
> [Privacy policy]
>
> **[ I agree ]**
> Nothing is saved until you agree.

### UK

> **Одна річ, на яку потрібна ваша згода**
>
> Щоб допомогти {coach} готуватися до ваших сесій, Praximo записує та аналізує їх. Ось що саме це означає:
>
> 1. Аудіо ваших сесій записується.
> 2. Записи аналізує штучний інтелект. Результати отримує лише {coach} — більше ніхто їх не бачить.
> 3. Аудіо видаляється через 30 днів після розшифрування. Транскрипти та результати аналізу зберігаються, доки {coach} їх не видалить.
> 4. Уся обробка відбувається в ЄС, окрім аналізу штучним інтелектом — він виконується у США. Ці запити проходять через Cloudflare AI Gateway, який зберігає їх журнал.
> 5. Ви можете відкликати цю згоду або попросити видалити ваші дані будь-коли — просто скажіть про це {coach}.
>
> [Політика конфіденційності]
>
> **[ Даю згоду ]**
> Нічого не зберігається, доки ви не погодитесь.

### RU

> **Одна вещь, на которую нужно ваше согласие**
>
> Чтобы помочь {coach} готовиться к вашим сессиям, Praximo записывает и анализирует их. Вот что именно это значит:
>
> 1. Аудио ваших сессий записывается.
> 2. Записи анализирует искусственный интеллект. Результаты получает только {coach} — больше их никто не видит.
> 3. Аудио удаляется через 30 дней после расшифровки. Транскрипты и результаты анализа хранятся, пока {coach} их не удалит.
> 4. Вся обработка происходит в ЕС, кроме анализа искусственным интеллектом — он выполняется в США. Эти запросы проходят через Cloudflare AI Gateway, который ведёт их журнал.
> 5. Вы можете отозвать это согласие или попросить удалить ваши данные в любой момент — просто скажите об этом {coach}.
>
> [Политика конфиденциальности]
>
> **[ Даю согласие ]**
> Ничего не сохраняется, пока вы не согласитесь.

> **Note.** Element 4 names the AI Gateway logging explicitly. The earlier throwaway draft in `prototypes/client-web-flow/src/lib/i18n.ts` dropped it; that draft is superseded by this document.

## 2. Pre-join notice

One informational line on the web room's pre-join screen. The join click is logged; **no new Consent Grant is created**. Three variants were drafted; **the factual variant is chosen** — it matches the always-visible in-room recording indicator, does not read as a second consent ask (which the "as you agreed earlier" variant risked), and does not need gender agreement in UK/RU (which the benefit-framed variant did: `отримав(-ла)`).

| Locale | Line |
| --- | --- |
| EN | This session is recorded and analysed by AI for {coach}. |
| UK | Ця сесія записується та аналізується ШІ для {coach}. |
| RU | Эта сессия записывается и анализируется ИИ для {coach}. |

Surrounding screen copy (title, session line, join button, device-check hint) is already covered by the web-room spec and the client-flow prototype.

## 3. Privacy policy

An app route on `me.praximo.io`, served by the Client Worker —
[privacy-retention.md](privacy-retention.md) §Documents owns why it is a route
rather than a static page. Linked from Client consent and Coach terms. Authored
in all three languages and rendered per locale out of `@praximo/i18n`.
Structure, in order:

1. **Opening** — one sentence on what Praximo is.
2. **Who is responsible for what** — coach = controller and the person to ask; platform = processor running the software on their instructions. Operator legal name placeholder.
3. **What we hold** — profile; session audio (one track per person); transcripts and AI notes; consent and technical records. Plus the Google profile import: name, photo, email, `sub` read only on the client's click, access token not stored.
4. **What it is used for** — running sessions and producing the coach's notes; nobody but the coach sees them; no sale, no advertising, no model training on recordings or transcripts.
5. **Where it is processed** — EU for everything except US LLM analysis via Cloudflare AI Gateway (logged), providers under no-training terms. Followed by a subprocessor table: Cloudflare (hosting, storage, email, AI gateway), Neon (database, Frankfurt), Deepgram (STT, EU, zero retention), LiveKit (self-hosted, EU), LLM providers (US, placeholder), Telegram, Google (only on profile import).
6. **How long it is kept** — audio 30 days after transcription; transcripts and notes until the coach deletes them; **deleted data survives in backups up to 7 more days**. Deletion is permanent, no undo, no archive.
7. **Your rights** — access, correction, deletion, withdrawal, at any time and without reason; route is through the coach, with a platform contact as fallback. States plainly that **withdrawal stops new scheduling but does not itself delete existing data** — deletion must be asked for separately.
8. **Security** — encryption in transit and at rest, least-privilege access, breach notice to the coach who tells the client.
9. **Changes** — coach notified, version on the page changes, the agreed version is recorded with the consent.

Full drafted text: `prototypes/privacy-copy.html`, tab 3, on branch `prototype/privacy-copy`.

## 4. Coach terms of service

Accepted at first Mini App login; the acceptance fact and text version are recorded on Member. Authored in all three languages and rendered per locale out of `@praximo/i18n` ([#130](https://github.com/apshenichniy/praximo/issues/130)). Ten sections:

1. **What Praximo is** — and, explicitly, that it never coaches the client and never speaks to them beyond scheduling and reminders.
2. **Your account** — created by us on request, no self-registration, Telegram sign-in, per-workspace bot, account not shareable.
3. **Your responsibilities** — lawful basis for client data; no clients who have not accepted the presented consent; the coach handles client requests using the provided tools; AI output must be reviewed and is not medical, psychological, legal, or financial advice; no unlawful use, no recording people who have not consented.
4. **AI output** — assistive, not authoritative, may err; the competency framework is described in our own words, with **no affiliation with or endorsement by any coaching federation** (per the ICF licensing finding in [#4](https://github.com/apshenichniy/praximo/issues/4)).
5. **Availability and fees** — early access, no uptime guarantee, pricing placeholder.
6. **Processing your clients' data** — the DPA, kept inside the terms rather than as a separate document or acceptance. Roles (coach = controller, platform = processor); instructions given by using the product; scope of processing; subprocessors by reference to the privacy policy with notice before a new one starts and objection by closing the workspace; no training; confidentiality and security; the EU/US transfer accepted by use; assistance with client requests and breach notice; deletion permanent subject to the 7-day backup window, workspace closure deletes its data.
7. **Your data and ours** — practice data is the coach's, software is ours, no transfer of ownership.
8. **Ending it** — manual offboarding on request, bot released back to the coach, workspace data deleted; we may suspend for breach.
9. **Liability** — as-is, cap placeholder, no limiting of what cannot lawfully be limited.
10. **Changes and law** — notice of material changes, continued use is acceptance, governing-law and contact placeholders.

Full drafted text: `prototypes/privacy-copy.html`, tab 4, on branch `prototype/privacy-copy`.

> **Note.** Section 6 is the longest section of the terms — an accepted tension with the short one-pager register. If it reads as too heavy at implementation, the fallback is to split it into its own page and leave a one-line reference in the terms.
