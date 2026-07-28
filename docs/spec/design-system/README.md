# Shared Maia interface foundation

Status: **accepted** by implementation issue
[#215](https://github.com/apshenichniy/praximo/issues/215).

## Ownership

`@praximo/ui` is the only owner of the shared visual foundation used by Admin,
Coach, Client, WWW React islands, and UI Lab:

- the clean shadcn preset `bcB3Gj2` — Maia, Base UI, Zinc/Violet, Inter, and
  HugeIcons;
- Geist Mono;
- light and dark semantic CSS tokens;
- the union of shadcn primitives actually consumed by the applications;
- `cn` with standard `tailwind-merge`;
- transitional `Heading`, `Text`, and typography recipe compatibility
  scaffolding;
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
  separated from accepted foundation decisions.

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
- absence of the old private type scale and merge extension.
