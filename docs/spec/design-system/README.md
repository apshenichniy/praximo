# One design system for both apps

Status: **proposal, awaiting a chosen variant** ([#198](https://github.com/apshenichniy/praximo/issues/198)).
Nothing here has been applied to `apps/web`.

The four variants are rendered, in both schemes, on the comparison rig:
<https://claude.ai/code/artifact/8c20c897-75ae-4e28-bc1d-ca230f747b48>

## The defect this starts from

On the scheduling screen a time slot, a duration chip and a day in the strip are
drawn with **no fill at all** — a transparent background and a `border-border`
hairline (`scheduling-screen.tsx:668`, `day-strip.tsx:216`). That hairline is
**1.22:1** against the page. The chosen state takes `bg-primary`, which is
near-black. A control therefore has two states: invisible, or black.

The screens did not arrive there by accident — they routed around the token,
because the token would not have helped:

| token | job | light value |
| --- | --- | --- |
| `--secondary` | a quiet control | `oklch(0.945 0.002 197.1)` |
| `--muted` | a recessed surface | `oklch(0.945 0.002 197.1)` |
| `--accent` | a hover state | `oklch(0.945 0.002 197.1)` |

Three semantics, one number, **1.04:1** against a page of `oklch(0.965 …)`.
shadcn ships them equal because on a pure-white page all three jobs happen to
look right at the same value. Once the page receded ([#195](https://github.com/apshenichniy/praximo/issues/195)),
none of them do. The dark scheme was never affected — there the same triple sits
at ~1.6:1 off the page — which is why the regression arrived with the light
ground and not before.

## The structure

Four groups. The group an element belongs to decides which tokens may touch it.

**Ground** — surfaces content sits on, never the fill of something pressable.
`--background` · `--card` · `--popover` · `--muted` · `--foreground` ·
`--muted-foreground` · `--border`

**Control** — things you press. This is the axis that is missing today.
`--secondary` · **`--control-border`** · `--primary` · `--accent` · `--ring`

**Brand** — new. The mark's own violet, which appears nowhere in the interface
today except the `admin-avatar` gradient.
**`--brand`** · **`--brand-foreground`** · **`--brand-surface`** · **`--brand-border`**

**Status** — meaning, never hue. Already in place; gains a surface per status so
the twenty-two ad-hoc alpha steps in use today have something to become.
`--success` · `--warning` · `--info` · `--destructive` · **`…-surface`** · `--pressed`

### The rule

> A Ground token is never the fill of something you can press. A control's
> resting state is `--secondary` plus `--control-border`; its chosen state is
> `--primary` (or `--brand`); its press is `--pressed` on top. `--muted` is a
> surface. `--accent` is a state.

## The three missing invariants

`theme-contrast.test.ts` asserts running text, secondary text, the surface
steps, the hairline and the press — and **nothing about a control at rest**.
That is the gap the regression came through, and it is the one thing that has to
be added whichever variant wins:

| assertion | floor |
| --- | --- |
| control against its page | 1.08 |
| control's edge against the page | 1.40 |
| control's edge against its own fill | 1.25 |

Two existing assertions also need revisiting: `accent` should be measured
against the **card** (a hover wash lands on raised surfaces, never on the page),
and `--pressed` should be derived from the page's lightness rather than fixed —
a fixed 10% was correct for exactly one page value.

## The brand colour

Sampled from `assets/branding/coach-bot/{light,dark}/avatar-512.png`; there is
no vector source in the repo.

The mark is an **indigo-violet at OKLCH H ≈ 282°, C ≈ 0.20** — the modal hue of
both masters, agreeing to within half a degree (chroma-weighted mean 285.5° /
285.1°). That is between Tailwind `indigo-600` (277°) and `violet-600` (293°),
and closer to indigo. `oklch(0.42 0.207 282.8)` (`#4627B6`) is the single most
common chromatic pixel in the light master.

Worth noting: the hardcoded `admin-avatar` gradient uses `violet-700 →
indigo-950`, about 10° more violet than the mark actually is.

## The four variants

Each varies four independent axes, so they can be mixed rather than chosen whole.

| | brand | control | elevation | type |
| --- | --- | --- | --- | --- |
| **Orbit** | tint only; `--primary` stays ink | raised, soft edge | hairline-first | tracking table |
| **Practice** | the primary — violet CTAs | raised, soft edge | soft, two-layer | weight-led |
| **Studio** | primary + the whole neutral ramp tinted | recessed, fill carries it | three-layer | retuned down (body 15→14) |
| **Signal** | brighter primary + a warm accent | raised, hard 2.0:1 edge | overlays only | legibility-first |

Studio is the only one carrying a real risk: it reverses #186's body-size
decision, which that issue called "the single change with the widest reach".
Signal's warm accent is the one [#170](https://github.com/apshenichniy/praximo/issues/170)
reserves for human moments; whether the product needs it yet is open.

## How the numbers were produced

`build.py` states only what is actually decided per variant — the neutral hue,
how far the page recedes, which direction a control moves from it, the brand
colour and how loud its role is. Everything else is solved against a contrast
target, so **no value here was chosen by eye**:

```sh
python3 docs/spec/design-system/build.py
```

It prints the gate table for all four variants and writes `variants.json`.
`tokens.py` carries the OKLCH → sRGB conversion (the same folded matrix
`theme-contrast.test.ts` uses, self-tested against known values) and `solve.py`
the three solvers — in-gamut chroma clamping, lightness-for-a-target-ratio, and
the out-of-sRGB excursion measure.

This is reference tooling, not build tooling; it is Python in a bun repo
deliberately, because its only job is to show the derivation. When a variant is
chosen it should be ported to `scripts/` in TypeScript and made to emit the
`app.css` block directly.

## Out of scope

- **Motion** — #186 stands: four durations, three curves, no springs, no stagger.
- **Radii** — the current scale off `--radius: 0.625rem` stays.
- **Theme selection** — already automatic (Telegram's scheme, then
  `prefers-color-scheme`), and already shared with admin.

## One correction this forces

`docs/spec/admin-surface.md:9` and `:22` still say the admin tree has "its own
Tailwind theme … a different design system is expected". That was reversed in
`9984979ab`, and `global-theme.test.tsx:85-96` now fails if a route-scoped admin
theme comes back. The sentence has to go.
