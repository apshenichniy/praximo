# PROTOTYPE — client web flow (wayfinder [#28](https://github.com/apshenichniy/praximo/issues/28))

Throwaway TanStack Start + shadcn app validating the **non-Telegram client UX**
end to end, per `docs/spec/client-onboarding-auth.md`: invite email → web
acceptance page → reminder email → pre-join → room, plus the coach side
(ready-to-forward bot reminder, Mini App session card with copy-link /
iOS-only share).

Everything is mocked, nothing persists. Not production code.

## Run

```sh
bun install
bun run dev   # http://localhost:3000
```

The `/` route is the flow map; the floating bottom bar cycles through the
steps. `/facts` lists the assumptions to fact-check before folding
corrections into the spec (the ticket's exit criterion).

Two demo invites: `/invite/inv_email_demo` (email delivery — no email field)
and `/invite/inv_link_demo` (manual forwarding — optional email field,
channel self-upgrade). Any other token shows the expired-invite screen.
