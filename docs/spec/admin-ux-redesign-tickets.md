# Admin Mini App UX redesign — ticket package (draft)

Source: live-testing feedback session, 2026-07-24. Design artifact (mockups + API analysis):
https://claude.ai/code/artifact/e0dd5959-2b86-4415-9a11-cd58dbc58e69

Status: **filed on the tracker, 2026-07-24.** T1–T9 → issues
[#102](https://github.com/apshenichniy/praximo/issues/102)–[#110](https://github.com/apshenichniy/praximo/issues/110)
(in order), with native blocked-by dependencies. Map:
[#111 Wayfinder map: Admin Mini App UX redesign](https://github.com/apshenichniy/praximo/issues/111);
decision tickets [#112](https://github.com/apshenichniy/praximo/issues/112)–[#114](https://github.com/apshenichniy/praximo/issues/114).
Amendments below applied to [#51](https://github.com/apshenichniy/praximo/issues/51) (body edit + comment)
and as comments on [#58](https://github.com/apshenichniy/praximo/issues/58),
[#86](https://github.com/apshenichniy/praximo/issues/86), [#83](https://github.com/apshenichniy/praximo/issues/83).
This file is now a historical record of the package; the issues are canonical.

---

## New tickets

### T1 — Short invite code replaces HMAC token

**What to build**

Replace the `ws_{inviteId}_{sig}` start param (55 chars) with a short random code:
`ws_{code}`, where `code` is 8 chars of Crockford base32 (no 0/O/1/I). Store the code
on `coach_onboarding_invite` (unique column); the bot resolves invites by code lookup.
Drop the HMAC scheme in `packages/auth/src/coach-onboarding-token.ts`; keep a cheap
format regex as the pre-DB junk filter. `requestId` stays for idempotency only.

**Acceptance criteria**

- [ ] Deep link is `t.me/{bot}?start=ws_XXXXXXXX`; old-format links are rejected with the existing invalid-invite text
- [ ] Code alphabet excludes 0/O/1/I; collision on insert retries with a fresh code
- [ ] `COACH_ONBOARDING_TOKEN_SECRET` and HMAC code removed
- [ ] Reissue generates a new code; the old code stops resolving

### T2 — "Invite a coach" screen: lazy create + three delivery actions

**What to build**

Replace the "New workspace" form with the action-first "Invite a coach" screen (artifact,
frames 1–4): one optional internal-label field; three delivery actions (Telegram / Email /
Copy). Tapping an action creates workspace + invite lazily (existing `requestId`
idempotency) and performs the delivery. Remove coach-language, description, short
description and avatar upload from the create flow; make those fields optional in
`CreateWorkspaceInput`. Drop the "Workspace created" success screen: success = toast +
pending card in the list. Copy action copies the full forwardable message via
`navigator.clipboard.writeText`, with the invite-language chips (en default / uk / ru).

**Acceptance criteria**

- [ ] Backing out before any delivery action creates nothing
- [ ] Double-tap or retry of the same action does not create duplicates
- [ ] Copy works on iOS and Android Telegram clients
- [ ] Invite row records delivery channel + destination (for the pending card and Resend)
- [ ] Dev stage verified live on the operator's phone

**Blocked by:** T1

### T3 — Telegram delivery via prepared share message

**What to build**

New `ManagerBotSender` RPC + server fn `prepareInviteShareMessage(inviteId)`: calls Bot API
`savePreparedInlineMessage` (manager's `user_id`, `allow_user_chats: true`) with the invite
message + inline "Start onboarding" URL button carrying the deep link; returns the prepared
message id. Mini App calls `WebApp.shareMessage(id)` → native chat picker. Prepare on tap
(prepared messages are short-lived). Fallback for clients < Bot API 8.0
(`isVersionAtLeast`): `openTelegramLink("https://t.me/share/url?…")`.

**Acceptance criteria**

- [ ] Happy path: manager picks a chat, coach receives the bot-authored message with a working button
- [ ] Share dialog cancel → invite stays pending, UI returns cleanly
- [ ] Old-client fallback path sends a functional plain-text invite
- [ ] Prepared-message expiry / failure surfaces a retryable error, not a broken state

**Blocked by:** T2

### T4 — Email channel UI stub

**What to build**

Email action opens a bottom sheet (email input + invite-language chips) fully styled per the
artifact (frame 3); "Send invite" shows a toast "Email delivery is coming soon" and does not
create a delivery. No provider integration in this ticket. When delivery lands later it
will use **Cloudflare Email Service + React Email** (decision of record; supersedes Resend).

**Acceptance criteria**

- [ ] Sheet validates email format client-side
- [ ] Send shows the toast; no invite email is sent; no delivery channel recorded
- [ ] The sheet's submit path is a single function stub where the real sender will plug in

**Blocked by:** T2

### T5 — Universal entry + role dispatch for the manager bot Mini App

**What to build**

Keep the manager bot's global Main Mini App / menu button. Entry route resolves the
viewer's role via a new `resolveRole(initData)` server fn: admin → redirect `/admin`;
coach mid-onboarding → stub screen (full onboarding companion is out of scope); active
coach → "your workspace lives in your bot" screen with an open-bot link; unknown →
invite-only landing. Record `startedByTelegramId` + a `started` marker on the invite when
`/start` presents a valid invite, so mid-onboarding coaches are recognizable. Replace the
`AccessDenied → notFound()` mapping: non-admins must never see "Page not found", and no
admin content may flash before the gate resolves.

**Acceptance criteria**

- [ ] Admin flow unchanged (menu button → workspace list) with no visible extra hop
- [ ] Non-admin sees the correct role screen; no 404, no content flash
- [ ] `/start` with a valid invite records the opener's Telegram id; pending card can show "Link opened"
- [ ] Unknown user sees the invite-only landing

**Blocked by:** T1 (invite lookup), independent of T2–T4

### T6 — Coaches list redesign

**What to build**

Rename the list surface to "Coaches" (artifact, frame 5). Pending invites pinned on top
with status progression: "Invited via {channel} · expires in Nd" → "Link opened · creating
bot…" → "Invite expired"; inline actions Resend / Copy link (no revoke — expired invites
die by reissue or deletion). Active coaches alphabetical: bot avatar, name,
`@botUsername`, status badge (`Connected` / `Needs re-link` warning, display-only),
"active 2h ago" from `member.lastActivityAt` (new list aggregate). Muted placeholder row
"— clients · — sessions" (aggregates deliberately not built yet; unlocks in a later phase).
No search.

**Acceptance criteria**

- [ ] List query extended with `lastActivityAt` (single query, no N+1)
- [ ] Pending progression states render from invite fields incl. `startedByTelegramId`
- [ ] Placeholder counts are visibly muted and not mistakable for zeros
- [ ] Empty state points at "+ Invite"

**Blocked by:** T2, T5

### T7 — Workspace details redesign (pending + active) & branding removal

**What to build**

Two variants of the details screen (artifact, frames 6–7).

*Pending:* invite status card (channel, issued, expires, link-opened), Resend / Copy link,
"What happens next" step list mirroring the coach's onboarding, danger zone. No settings.

*Active:* header (bot avatar, name, `@botUsername`, "Open bot"); status card (bot status,
coach `lastActivityAt`/`lastLoginAt`, `termsAcceptedAt`); About (coach language, joined
date); Practice (muted placeholders); Settings (internal-label rename only — label is
admin-only, defaults to the coach's Telegram name, label wins when set); danger zone.

Remove manager-side branding editing entirely: description/shortDescription/avatar fields,
`updateWorkspaceProfile` branding path, retry-branding UI. Provisioning instead sets a
Praximo-branded default: a generated initial-on-gradient avatar + templated description
("Coaching with {coach} · powered by Praximo"); the coach rebrands from their side.

**Acceptance criteria**

- [ ] Pending and active variants render per mockups; `needs-relink` badge display-only
- [ ] Branding editing gone from admin; internal-label rename works with optimistic concurrency
- [ ] Provisioning sets default avatar + description on the new bot
- [ ] Joined date sourced from member creation / terms acceptance

**Blocked by:** T6

### T8 — Deletion: fix the stuck pipeline (adopt + reconcile)

**What to build**

Bug: orphaned `workspace_deletion_operation` rows in `state='prepared'` permanently block deletion
("Another deletion request is already in progress") because the client mints a fresh
`requestId` per mount and `prepare` resumes only on exact `requestId` match. Fix
server-side: on conflict, **adopt** the existing prepared operation for the workspace
(wire up the unused `isDeleting` helper or replay-by-workspace) and return it so the
client drives it to completion; extend cleanup to reconcile orphaned prepared rows.

**Acceptance criteria**

- [ ] A workspace with an orphaned prepared row can be deleted on the next attempt without manual DB surgery
- [ ] Interrupted deletion resumes (same steps not re-executed where already terminal)
- [ ] Regression test: prepare → interrupt → new session → delete succeeds

### T9 — Deletion UX: two-step sheets + pipeline progress

**What to build**

Replace typed-name confirmation (artifact, frames 8–10). Active workspace: sheet 1 with
concrete consequences (Cancel prominent, Delete quiet); sheet 2 with flipped button order,
changed labels ("Yes, delete everything" / "Keep workspace") and a 3-second arming
countdown on the destructive button; then live pipeline progress (sessions cancelled →
farewell → release bot → purge), closable — deletion continues in background; interrupted
deletion shows the list card as "Deleting…" with Resume. Pending workspace (no bot): a
single light confirm sheet "Delete invite and workspace?".

**Acceptance criteria**

- [ ] No text input anywhere in the flow
- [ ] Countdown restarts if sheet 2 is reopened; buttons order/labels differ from sheet 1
- [ ] Progress reflects actual pipeline step states; resume works end to end
- [ ] Pending deletion completes in one light confirm

**Blocked by:** T8

---

## Amendments to existing tickets

- **[#51 Delete workspace: typed-name confirmation + hard cascade](https://github.com/apshenichniy/praximo/issues/51)** —
  the cascade machinery it describes largely exists; its UX acceptance criterion
  ("typing the exact workspace name") is **superseded** by T9. Suggest: narrow #51 to any
  remaining cascade gaps, drop the typed-name criterion, link T8/T9.
- **[#55 needs re-link detection and recovery](https://github.com/apshenichniy/praximo/issues/55)** —
  unchanged and consistent: the redesign ships the `Needs re-link` badge display-only; #55
  remains the detection/recovery effort.
- **[#58 Email channel: service-sent invite email](https://github.com/apshenichniy/praximo/issues/58)** —
  (client invites) should share the email infrastructure decision of record:
  **Cloudflare Email Service + React Email**, not Resend. Coach-invite email delivery
  (successor of T4's stub) should reuse the same sender + template stack.
- **[#86 Coach bots: "Open" menu button at provisioning](https://github.com/apshenichniy/praximo/issues/86)** /
  **[#83 Watch Bot API for a programmatic Main Mini App setter](https://github.com/apshenichniy/praximo/issues/83)** —
  unaffected for coach bots; note that for the **manager** bot the Main Mini App stays
  enabled by design (T5's role dispatch handles non-admin viewers), so no per-chat
  menu-button juggling is needed there.
- **Branding-related acceptance criteria** anywhere referencing manager-edited
  description/avatar (workspace profile editing) are superseded by T7.
