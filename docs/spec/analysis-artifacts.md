# Analysis artifacts: brief, debrief, mentor review

The three documents the agent produces around a session. Validated with the prototype on branch `prototype/analysis-artifacts` (wayfinder [#11](https://github.com/apshenichniy/praximo/issues/11)); this spec holds the decisions, the prototype holds the worked example. Entities and generation moments are fixed in [domain-model.md](domain-model.md) (`Artifact.kind = brief | debrief | mentor_review`) and the pipeline in [ADR 0001](../adr/0001-processing-pipeline-on-cloudflare-workflows.md).

## Shape principles (all three)

- **Prose, not bullets.** Lists survive only where the content *is* an enumeration — the client's agreements. Everything else is connected paragraphs: a paragraph forces the model to show the link between facts, and it is the link, not the facts, that a coach cannot reconstruct two weeks later.
- **One document, one purpose, no overlap.** If a thing could go in two documents, it belongs to one and is absent from the other. The split is enforced below.
- **Headings are commitments, not labels.** "What stayed open" over "Other"; "Threads that carry over" over "History". A vague label invites the model to dump whatever didn't fit.
- **No long quotes.** One or two short quotes per document as a memory anchor. Retelling the transcript produces a second transcript, not a document.
- **~400–600 words per document.** Upper bound of readable-in-Telegram; also the practical cap for the reader.
- Written in the **coach's** language (`en | uk | ru`). No gender-agreeing verb forms addressed at the coach — the system does not know the coach's gender (wayfinder [#16](https://github.com/apshenichniy/praximo/issues/16)).

## The split

| Document | Question it answers | About whom | When read |
|----------|--------------------|-----------|-----------|
| **Brief** | Where did we stop, what do I walk in with? | Client + cycle history | Minutes before the session |
| **Debrief** | What happened in this session? | Client + content of the talk | Right after; later an archive |
| **Mentor review** | How did I work, what to do differently? | The coach | Not immediately — when ready to read about oneself |

Consequences of the split, each a deliberate exclusion:

- **The debrief carries no assessment of the coach.** It is read right after the session, often between calls; critique in that moment mixes two different jobs. Everything about the coach lives in the mentor review.
- **The mentor review carries no scores or scales.** ICF states the markers are not to be used as a checklist; assessment is holistic, competencies named by name inside prose, not scored one by one.
- **The brief carries no session plan.** Possible entry points and things to watch for — but not an agenda: a coach walking in with a fixed agenda stops following the client.

### Brief sections

Where we are · Last time · What they left with (their agreements — a list) · Threads that carry over · Possible entry points · What to watch for. Built from the client's prior debriefs and reviews, including the two just generated (per ADR 0001). Skipped when no prior artifacts exist (typically the intake session).

### Debrief sections

Session request · How the talk went · What shifted · Agreements (a list) · What stayed open. Written from the merged transcript; the intake session's debrief is a different document by content (request, coaching contract, cycle agreements) — already modelled via `Session.kind = intake`.

### Mentor review sections

Overall impression · What worked (2–3, each anchored to what happened) · Growth area (1–2, each with an alternative move) · On the PCC level · One experiment for next session (not a task list). Grounded in a **paraphrase** of the ICF Core Competencies model — never verbatim ICF text (licensing, wayfinder [#4](https://github.com/apshenichniy/praximo/issues/4)); attribute the framework, disclaim ICF affiliation, note the assessment is from a transcript.

- **Register: direct "Вы" / second person.** The review addresses the coach directly ("Вы дали паузу"), not in the third person ("the coach gave a pause"). Warmer for a development document, and a plural-agreeing verb sidesteps the unknown-gender constraint (#16). Brief and debrief stay third-person about the client — they do not address the coach at all. The English/Ukrainian renderings follow the same direct-address choice.

## Delivery

One message per document via `sendDocument`: the `.md` file, a caption summary under it, a Mini App button under that. The coach taps the file → Telegram's built-in viewer renders the markdown (serif headings, bold, links, monospace). Verified on iOS against a screen recording; on desktop an "unsafe preview" warning precedes the same render — reason enough for the Mini App button to always be present, not just a fallback.

Bot API facts (verified against Bot API 10.2, 2026-07-14):

- `sendDocument.caption` — **0–1024 characters** (half the 4096 of a plain message). This is the real summary bound, ~130–150 RU words; a feature, not a limit — it forces a *summary*, not the document's opening.
- `sendDocument` accepts `reply_markup` with an inline keyboard.
- `InlineKeyboardButton.web_app` is allowed **only in private chats between a user and the bot** — exactly our case (the coach ↔ workspace bot). The button carries the reader URL directly; no separate short link needed.
- Upload cap 50 MB; a 6 KB `.md` is a non-issue. `InputFile` accepts a `Uint8Array` / `Blob`, so no filesystem in the Worker.

The summary is **not a separate LLM call** — it comes back from the same generation request as the document, in its own field: one run, one cost, and the summary is guaranteed to be about the same text.

```ts
await api.sendDocument(
  coachTelegramId,
  new InputFile(bytes, "Дебриф — Андрей К. — 18.07.md"),
  {
    caption: summary,            // ≤ 1024, from the same LLM run
    parse_mode: "MarkdownV2",
    reply_markup: { inline_keyboard: [[{
      text: "Открыть в приложении",
      web_app: { url: readerUrl }, // app.praximo.io/a/<artifact>
    }]] },
  },
);
```

What this settles: the 4096-char message limit no longer constrains the mentor review; export comes for free (the viewer's own "Share" / "Save to files" — no separate export feature in MVP); the Mini App stays the reader and archive (#15) but is no longer the only way to read a document whole.

### Delivery decisions

- **The viewer's title comes from the document's first heading, not the filename** (observed: file `0001-…md`, viewer title "ADR 0001: Processing pipeline…"). So H1 is part of the UI and must explain itself: `Дебриф: Андрей К., сессия 4, 18 июля`.
- **A new brief version replaces the file in the same message** via `editMessageMedia` + `editMessageCaption` — no stale briefs pile up in the chat; the delivery row keeps the message id against the artifact. Prior versions remain in the Mini App reader (artifacts are versioned, #15).
- **Debrief and mentor review are spaced 5 minutes apart.** Both are ready from one pipeline run, but the review — about the coach's own work — should not be read on the emotions of just having finished. The debrief goes immediately; the review five minutes later.

## Open (implementation-time)

- Filename truncates mid-string in the file card (start + tail shown) — put the document kind first, the date last: `Дебриф — Андрей К. — 18.07.md`.
- Cyrillic filenames unverified across clients; fallback is Latin with a transliterated kind/date.

## Prompt layout

Per ADR 0001, one structure for all three tasks — stable prefix, then data, then instruction — so the prefix caches at the provider and the variable part stays in the tail:

1. system: role + writing rules (stable)
2. paraphrased ICF materials (mentor review only, stable)
3. document template: sections and what goes in them (stable per document kind)
   — cache boundary —
4. data: transcript / prior artifacts (variable)
5. task: language, session kind, what to return (variable)

Debrief and mentor review of one run execute in the same time window so the shared prefix can hit the cache TTL; economics do not rely on cache hits (ADR 0001).
