# Shared Maia interface foundation

Status: **accepted** by implementation issue
[#215](https://github.com/apshenichniy/praximo/issues/215).

## Ownership

`@praximo/ui` is the only owner of the shared visual foundation used by Admin,
Coach, Client, WWW React islands, and UI Lab:

- the clean shadcn preset `bdKVekM4` — Maia, Base UI, zinc/violet, Inter, and
  HugeIcons;
- Geist Mono;
- light and dark semantic CSS tokens;
- the union of shadcn primitives actually consumed by the applications;
- `cn` with standard `tailwind-merge`;
- interface typography recipes and the shared `Heading` / `Text` primitives;
- motion foundations and reduced-motion behavior;
- a host-neutral feedback contract;
- UI Lab.

Apps import the shared CSS and may add a local `src/styles/app.css` only for
app-specific needs. They do not override shared base tokens or copy shared
primitives. A need repeated across applications moves into `@praximo/ui`.

`@praximo/ui` never imports Telegram SDKs, TanStack application code, routers,
or business/domain features. Admin and Coach adapt feedback to Telegram at
their presentation-host boundary. Client and WWW use the no-op adapter until a
browser-specific effect is justified. Mutation-outcome feedback remains in
feature code.

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

The shared semantic vocabulary is:

| Role | Purpose |
| --- | --- |
| `display` | Rare primary value or WWW hero |
| `page-title` | Page-level heading |
| `section-title` | Section heading |
| `card-title` | Card and compact panel heading |
| `body` | Default product copy |
| `body-small` | Supporting product copy |
| `label` | Control and data label |
| `caption` | Metadata and compact annotation |

`mono` is a font-family modifier, not a size role. Each recipe owns family,
size, line height, weight, and tracking. Tone remains independent.

`Heading` keeps semantic HTML (`h1`–`h6`) independent from visual role. `Text`
does the same for free-standing copy. Component slots such as `CardTitle`,
`CardDescription`, `FieldLabel`, `Button`, and `Badge` consume the same recipes
instead of reconstructing typography in caller `className` values.

Typeset is an opt-in prose layer only. It may be added when a real rendered
HTML/Markdown, legal, or long-report consumer needs it; it never styles
application shells, cards, forms, or dashboards.

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
- every typography role and component recipe across page, section, card, form,
  table, and dense application contexts;
- short/long Latin and Cyrillic samples, wrapping, truncation, tabular numbers,
  mobile/desktop widths, and both themes.

## Motion

Start from the clean Maia baseline, then audit for purposeful motion.

- Prefer CSS and `data-state` transitions for primitive state changes.
- Do not use `transition-all`, default mount animation, or decorative stagger.
- Add a motion library only for a proven layout or screen-transition need.
- Reduced motion is mandatory.
- Tune durations/easings in UI Lab and on a real device.

## Validation

Tests at the `@praximo/ui` owner boundary cover:

- light/dark token and status-family completeness;
- contrast for text and status usages;
- package exports and absence of Telegram/TanStack/router dependencies;
- reduced-motion behavior;
- typography role completeness and shared recipe ownership;
- absence of the old private type scale and merge extension.
