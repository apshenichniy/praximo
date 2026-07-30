# Shared Maia interface foundation

Status: **accepted** by implementation issue
[#215](https://github.com/apshenichniy/praximo/issues/215).

## Ownership

`@praximo/ui` is the only owner of the shared visual foundation used by Admin,
Coach, Client, WWW React islands, and UI Lab:

- the clean shadcn preset `bcB3Gj2` — Maia, Base UI, Zinc/Violet, Inter, and
  HugeIcons, with one recorded exception: the package ships **no webfont at
  all**, and `--font-sans` / `--font-mono` are app-owned in the two web
  applications (#255);
- light and dark semantic CSS tokens;
- the union of shadcn primitives actually consumed by the applications;
- `cn` with standard `tailwind-merge`;
- transitional `Heading`, `Text`, and typography recipe compatibility
  scaffolding;
- `typeset.css`, the prose layer, and the presets that configure it;
- motion foundations and reduced-motion behavior;
- a host-neutral feedback contract;
- UI Lab.

Apps import the shared CSS and may add a local `src/styles/app.css` only for
app-specific needs. They do not override shared base tokens or copy shared
primitives, with one named exception: `--font-sans` and `--font-mono` are owned
by each of the two web applications (§Interface faces). A need repeated across
applications moves into `@praximo/ui`.

`@praximo/ui` never imports Telegram SDKs, TanStack application code, routers,
or business/domain features. Admin and Coach adapt feedback to Telegram at
their presentation-host boundary. Client and WWW use the no-op adapter until a
browser-specific effect is justified. Mutation-outcome feedback remains in
feature code.

The operational baseline/extension rules for implementation agents live in
[`docs/agents/ui-development.md`](../../agents/ui-development.md).

## Removed contract

#215 replaces rather than evolves the previous Iris system. The following are
not part of the new foundation:

- Iris and the reserve brand sets;
- generated token blocks and the Python apply/build/solver tooling;
- duplicated app-owned primitives and parity tests;
- the private `--text-*` scale and custom `tailwind-merge` extension;
- brand/control/pressed legacy tokens and special component variants;
- the old duration/easing namespace.

Static CSS committed in `@praximo/ui` is authoritative. UI Lab may edit status
colors live and copy CSS, but it is not a generator.

## Interface typography

The semantic interface typography contract was intentionally deferred after the
#215 reset. The current `Heading`, `Text`, and `typographyRecipe` exports keep
existing screens working, but their role names and values are transitional
compatibility scaffolding rather than accepted design decisions.

Do not inject those recipes into copied shadcn primitives. A follow-up
typography round starts from the accepted pure baseline, chooses the semantic
vocabulary and values deliberately, and migrates application composition only
after that choice.

## Interface faces

Status: **accepted** by implementation issue
[#255](https://github.com/apshenichniy/praximo/issues/255).

The applications split in two, and both interface families follow the split:

| Tier | Applications | `--font-sans` | `--font-mono` | Owned by |
| --- | --- | --- | --- | --- |
| Mini App | Admin, Coach | `system-ui, sans-serif` | `ui-monospace, monospace` | `@praximo/ui` |
| Web app | WWW, Client | `"Inter Variable", sans-serif` | `"Geist Mono Variable", monospace` | the app's own `app.css` |

A Mini App runs inside Telegram on someone's phone, one tap from the chat they
were just in. It should look like it belongs to that phone: `system-ui` and
`ui-monospace` resolve to SF on iOS, Roboto on Android, the shell's own faces on
desktop. **A Mini App downloads no font at all.** A web page has no host to
belong to — a visitor arrives cold, and WWW's entire job is to look like Praximo
to someone who has never seen it — so those two carry their own.

`system-ui` and `ui-monospace` are the keywords that name the platform's own
interface and monospace faces. Plain `sans-serif` and `monospace` would name the
browser's defaults instead, which in the iOS WebView means Helvetica — the
generic answer, not the native one. Both remain as trailing fallbacks.

The mechanical line is the `@praximo/mini-app` dependency: an application that
imports the Telegram host adapter takes the host's faces.

This is the one departure from the resolved preset that the baseline rule allows
and this document records, and it is the one carve-out from "apps do not
override shared base tokens" — those two variables and nothing else.
`--font-heading` still resolves through `--font-sans` in both tiers, so a web
app's override carries the headings with it, and the prose presets resolve
through all three, so `.typeset` follows its application's tier without knowing
the tier exists.

What the Mini Apps give up is a typographic identity of their own; what they get
back is the platform's faces, hinting and metrics on every device, nothing on
the critical path, and nothing to swap after first paint. Type therefore renders
differently per host and per tier, and any size, weight, or leading decision has
to be checked on more than one before it is accepted.

The contract tests are split the same way. The shared one is written as an
absence — no `@font-face`, no font `@import`, no vendored font directory, no
`@fontsource-*` dependency — because a webfont is exactly the kind of thing that
returns one `@import` at a time. Each Mini App asserts its own stylesheet does
not reach for a face; each web app asserts that it does, since nothing upstream
would supply one.

### Open

Which faces the web applications use. Inter and Geist Mono are the incumbents
rather than chosen faces; the question closes when the design round settles. The
tier boundary is what #255 decided — the faces on the web side of it are still a
draft.

## Prose

Status: **accepted** by implementation issue
[#223](https://github.com/apshenichniy/praximo/issues/223).

`packages/ui/src/typeset.css` owns block flow inside prose — the spacing between
paragraphs, lists, headings and tables in long-form content. It is generated by
the [shadcn Typeset builder](https://ui.shadcn.com/docs/typeset), which is a
generator rather than a registry item, and is committed here as the builder
emitted it. `styles.css` imports it after Tailwind, so every application already
has both the mechanism and the presets by importing the shared CSS as usual.

It is also exported as `@praximo/ui/typeset.css`. That export is the bare
mechanism — the presets below are Praximo's and ship in `styles.css`, because
`typeset.css` is regenerated rather than edited. Import it directly only to
configure your own preset; otherwise import `styles.css`.

It is a mechanism, not a scale. It ships no absolute type sizes of its own: it
exposes six variables per preset — three fonts and three numbers — and every
size it sets is relative to the one number a preset chooses. This is what keeps
it compatible with the deferred typography round rather than a pre-emption of
it. It is deliberately not `@tailwindcss/typography`, which ships its own scale
and colours.

The presets are the product decision and live in the Praximo extension layer of
`styles.css`. Each repoints the fonts at the shared theme variables — the
builder defaults to Geist — and sets nothing but the six variables:

| Preset              | Size | Leading | Flow     | Used by                              |
| ------------------- | ---- | ------- | -------- | ------------------------------------ |
| `.typeset-document` | 15px | 1.75    | `1.25em` | Legal texts; rendered artifacts next  |
| `.typeset-pane`     | 14px | 1.6     | `1em`    | Prose in a height-constrained pane    |

Values were chosen in UI Lab against Ukrainian and Russian text in both themes.
Why these:

- `.typeset` scales up by 1.125 below 48rem, so 15px reads at 16.875px on a
  phone and 15px on a desktop. Ukrainian and Russian run 15–20% longer than
  English, and the phone is where that costs lines; the desktop measure can
  afford to be a little smaller than interface body text.
- Leading 1.75 over the 1.625 interface body text. A reading column is read
  continuously rather than scanned, and Cyrillic ascenders and descenders make a
  tighter setting look crowded at this measure.
- Flow `1.25em` is 18.75px against a 26.25px line box — enough that a paragraph
  break reads as a break without the page feeling loose. Anything under about
  `1em` stops being legible as a break at all.
- The pane preset is the same shape one step tighter, because the consent gate
  is height-constrained and the reader has to reach its end.

### Boundary against interface typography

`typographyRecipe`, `Heading`, and `Text` govern interface chrome — labels, card
titles, captions, buttons. `.typeset` governs what is inside a prose block. They
do not overlap:

- do not apply an interface type role inside a prose block;
- do not use `.typeset` to style chrome.

Prose reads at a different size and leading from interface body text. That is a
deliberate choice — a reading column wants its own rhythm — and tests at both
ends hold the line.

## Theme behavior

- Admin and Coach follow the Telegram host theme. Browser preview falls back to
  the system theme.
- Client persists `system | light | dark`.
- WWW follows the system theme without a required visible switch.
- Every application surface is noindex during the single-environment phase.

## Status families

Both themes define `success`, `warning`, `error`, and `info`. Each family owns:

- base;
- foreground;
- surface;
- border.

`destructive` remains a separate action semantic and may initially share the
error hue. Static values are selected in UI Lab and committed to the shared CSS.
Tests own completeness and contrast at this shared boundary.

## UI Lab

`bun run ui:dev` starts the local lab independently. It contains:

- every primitive currently used by a product application;
- light/dark switching;
- default, hover, pressed, focus, disabled, error, and open states where
  applicable;
- live status-color editing for both themes, contrast indicators, reset, local
  draft persistence, and copyable CSS output;
- normal and reduced-motion inspection;
- an informational view of the transitional typography scaffolding, clearly
  separated from accepted foundation decisions;
- both prose presets against Ukrainian and Russian text, shown beside an
  interface role so the boundary is visible rather than asserted.

## Motion

Start from the clean Maia baseline, then audit for purposeful motion.

- Prefer CSS and `data-state` transitions for primitive state changes.
- Do not add product-specific `transition-all`, default mount animation, or
  decorative stagger. Preserve live-registry primitive classes verbatim.
- Add a motion library only for a proven layout or screen-transition need.
- Reduced motion is mandatory.
- Tune durations/easings in UI Lab and on a real device.

## Validation

Tests at the `@praximo/ui` owner boundary cover:

- light/dark token and status-family completeness;
- contrast for text and status usages;
- package exports and absence of Telegram/TanStack/router dependencies;
- reduced-motion behavior;
- absence of Praximo typography, feedback, motion-token, and color overrides
  inside copied shadcn primitives;
- absence of the old private type scale and merge extension;
- the prose layer as a mechanism: no absolute type scale, no vocabulary beyond
  its own class names, and presets that set nothing but the six variables;
- the boundary from the consuming side — no interface type role and no
  hand-spacing inside a prose block.
