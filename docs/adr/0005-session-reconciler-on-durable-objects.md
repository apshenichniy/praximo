# ADR 0005: Session reconciler on Durable Objects

- **Status:** accepted
- **Date:** 2026-07-20
- **Decided in:** wayfinder ticket [#24](https://github.com/apshenichniy/praximo/issues/24)

## Context

The web-room session lifecycle ([web-room-sessions.md](../spec/web-room-sessions.md)) requires a due-only reconciler: the sole writer of terminal session transitions, evaluating due thresholds (grace close, empty-room idle, room cap, next-session start) with roughly minute-level responsiveness. It also needs somewhere to serialize per-session concurrency: LiveKit webhooks, coach commands (extend, end-session), and due evaluation all race over the same session row.

Two candidate mechanisms on Cloudflare:

1. **Cron trigger every minute** scanning Postgres for sessions with an overdue threshold.
2. **One Durable Object per session** with an alarm armed at the session's earliest due instant.

## Decision

**One Durable Object per session (id = session id) is the reconciler actor.** Its alarm is armed at the earliest due threshold and re-armed whenever thresholds move (extension, occupancy change). All session-scoped inputs — provider webhooks, coach commands, due evaluation — are routed through the session's DO and processed single-threaded.

A **safety-net cron sweeper every 15 minutes** scans Postgres for non-terminal sessions with an overdue threshold and pings their DOs, recovering lost alarms. Terminal writes are additionally guarded by conditional UPDATEs, so even a duplicated actor cannot double-write.

## Rationale

- **Cost is decided by Neon autosuspend, not Workers pricing.** A minute-cron issues a Postgres query every minute even with zero active sessions, which keeps the Neon compute awake 24/7 (autosuspend needs ~5 idle minutes) — ~180 CU-hours/month at the minimum 0.25 CU, consuming most of a paid plan's included compute for nothing. DO alarms fire only around real sessions; Neon sleeps the rest of the day. The 15-minute sweeper is sparse enough to let autosuspend work. DO request/duration costs at MVP volume (a handful of sessions per day) are negligible.
- **Serialization for free.** The actor model collapses the race matrix: joint-join exactly-once, extension vs. due-close, end-session vs. webhook replay all reduce to "processed in arrival order by one thread", with CAS on the DB as the second belt.
- **Precision.** Alarms fire at the due instant, not at the next minute boundary.

The cost of the decision: a DO namespace joins the Alchemy stack ([ADR 0003](0003-alchemy-iac-structure.md)), and DO state (presence reduction, processed command ids) must be treated as rebuildable — Postgres remains the source of truth; a fresh DO re-derives occupancy from a live `ListParticipants` snapshot. Which Worker hosts the DO class (likely the one serving the web-room API) is settled at implementation.

## Alternatives rejected

- **Minute-cron scan**: simplest, but pays a 24/7 Neon compute bill at any scale and still leaves per-session serialization unsolved (advisory locks or CAS-retry loops would carry the race burden).
- **DO alarms without a sweeper**: alarms are durable but not beyond namespace deletion/migration mistakes; a lost alarm would strand a session in `in_progress` forever. The sweeper is cheap insurance.
