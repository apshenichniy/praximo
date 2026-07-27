# One design system for both apps

Status: **accepted — Iris is the brand set**
([#198](https://github.com/apshenichniy/praximo/issues/198), settled in
[#191](https://github.com/apshenichniy/praximo/issues/191)).

`origin`, `mark` and `fuchsia` stay in `sets/` as reserve rather than being
deleted: they differ from Iris in one variable, they all pass the invariants, and
keeping them makes a future re-judgement one command instead of a re-derivation.
Swapping is exactly that command:

```sh
python3 docs/spec/design-system/apply.py iris     # origin | mark | iris | fuchsia
```

Three files **per app** restate these values, and all of them move together —
`styles/app.css`, `routes/__root.tsx` (the critical stylesheet carries both
grounds inline, because the scheme is not known a few bytes further down the
head) and `lib/theme.ts` (the Telegram host chrome is painted through a bridge
call and cannot read a token). Six files since #191, when `apps/client` took the
same system. Leaving one behind is silent: the app renders, one test fails, and
the Telegram chrome keeps the previous colour. `apply.py` is what keeps them in
step, and `apps/client/src/__tests__/design-system-parity.test.ts` is what
notices a run that never happened.

## Two apps, one system, no package

The tokens are duplicated between `apps/web` and `apps/client` rather than
extracted into `@praximo/theme`. Considered and declined in #191, for the reason
#191 declined `@praximo/ui`: the surfaces are meant to be able to diverge, and
there is already one case in hand — the type scale is calibrated for a phone
webview and the client app's legal pages step it up on desktop. With one real
consumer and a second that had no screens yet, extracting would have been
guessing at which divergences are real.

What is duplicated is only the palette. The parity test is scoped to the
`:root` / `.dark` blocks precisely so the rest may differ: `apps/client` carries
no coach day strip, and its pages pick different steps of the scale.

**Extraction trigger.** Revisit when a *third* surface needs the system — the
landing page on `praximo.io`, or the web room if it grows its own app. Before
committing, spike Tailwind v4 content detection across a package boundary:
neither app declares `@source`, both rely on automatic detection, and a `@theme`
arriving from `node_modules` is not obviously covered by it.

The four sets differ **only** in the brand hue. Everything else — the neutral
ramp, the raised control at a 1.75 edge, hairline elevation, the tracking table —
is shared, so switching between them changes one variable.

The contrast invariants this ticket deferred — the ones for the two groups it
introduced — are now written, in `apps/web/src/__tests__/theme-contrast.test.ts`
(#191): status and brand ink read at AA on the tint they sit in; every tinted
surface steps off the surface it is laid on; `--brand-border` outlines a brand
region against the page, because on the light ground the fill alone is 1.04:1 —
a difference of hue with none of luminance.

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
today except the `brand-disc` gradient (`admin-avatar` until #191).
**`--brand`** · **`--brand-foreground`** · **`--brand-surface`** · **`--brand-border`**

**Status** — meaning, never hue. Already in place; gains a surface per status so
the twenty-two ad-hoc alpha steps in use today have something to become.
`--success` · `--warning` · `--info` · `--destructive` · **`…-surface`** · `--pressed`

### The rule

> A Ground token is never the fill of something you can press. A control's
> resting state is `--secondary` plus `--control-border`; its chosen state is
> `--primary` (or `--brand`); its press is `--pressed` on top. `--muted` is a
> surface. `--accent` is a state.

### The edge is not optional

`--control-border` applies even when the control already has a fill. The rig
found this the moment a sheet was drawn on it: Signal raises `--secondary` to
pure white, and a `secondary` button on a white sheet is nothing at all —
shadcn's own `secondary` variant ships `border-transparent`. That is the slot
failure again, one surface up, and it is why the edge is a token rather than a
per-variant flourish.

A control's fill says how far it sits from the page. Its edge says it is a
control. The fill can legitimately go to zero — the edge cannot.

The same rule retires the bare `ghost` button. Ghost has neither fill nor edge,
and its only resting mark is a `hover:` state that does not exist on a phone, so
standing alone on a page it renders as a paragraph that happens to answer a tap —
the slots' defect again, this time living in a variant rather than at a call
site. It stays right where something *else* marks the control: an icon button
inside a field, a day inside the calendar's grid, or the quiet destructive action
under a big Cancel that [#197](https://github.com/apshenichniy/praximo/issues/197)
made quiet deliberately.

## The invariants this added

**All written** — the control ones with #198, the Brand and Status ones with #191
once Iris was settled. Kept here because the floors are the decision, not the
code.

`theme-contrast.test.ts` had asserted running text, secondary text, the surface
steps, the hairline and the press — and **nothing about a control at rest**.
That is the gap the regression came through:

| assertion | floor |
| --- | --- |
| control against its page | 1.08 |
| control's edge against the page | 1.40 |
| control's edge against its own fill | 1.25 |

And, for the two groups this ticket introduced (#191):

| assertion | floor |
| --- | --- |
| status or brand ink on its own tint | 4.50 (AA — these are words) |
| any tinted surface against the card it is laid on | 1.08 |
| `--brand-border` against the page | 1.40 |

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

Worth noting: the hardcoded `brand-disc` gradient uses `violet-700 →
indigo-950`, about 10° more violet than the mark actually is.

### How far toward fuchsia

`brands.py` holds the recommended base fixed and moves only the hue, so the four
columns differ in exactly one thing. Each is the most saturated value sRGB has at
its hue that clears **both** jobs the token holds on the light ground:

| | H | light | on white | on page | dark |
| --- | --- | --- | --- | --- | --- |
| Знак | 283° | `#6a46ff` | 5.21 | 4.62 | `#9692ff` |
| Iris | 299° | `#9324ff` | 5.21 | 4.62 | `#b488ff` |
| Orchid | 311° | `#ab00ed` | 5.20 | 4.61 | `#cd7bff` |
| Fuchsia | 322° | `#b800d0` | 5.19 | 4.60 | `#eb66ff` |

The two jobs pull against each other. Solving only for white-on-brand gives a
step brighter — `#6d4eff` at H 283 — which then fails as a link at **4.35:1**
against the page. That is how one brand token quietly becomes two. Solving for
the page instead costs almost nothing visually (L 0.555 against 0.567) and keeps
it single.

Iris at 299° is the interesting middle: it is still literally in the artwork —
the bright tip of the arc measures 299° in the light master — while reading
distinctly more magenta than the mark's body. Orchid and Fuchsia leave the mark
behind and would make the logo the odd one out until #145's artwork is redone.

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
