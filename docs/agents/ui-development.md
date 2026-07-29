# UI development

Read this contract before changing shared UI, application styling, or shadcn
components.

## Source boundaries

`@praximo/ui` has three deliberately different layers:

1. `packages/ui/src/components/ui/**` contains the registry-owned shadcn
   primitives. The live registry and resolved preset `bcB3Gj2` — Maia, Base UI,
   Zinc/Violet, Inter, and HugeIcons — are the baseline.
2. `packages/ui/src/components/**`, excluding `components/ui/**`, contains
   Praximo-owned wrappers and shared composites built above those primitives.
3. Application feature directories contain product and domain composition that
   is not shared interface infrastructure.

The standard shadcn semantic theme values in the first `:root` and `.dark`
blocks of `packages/ui/src/styles.css` belong to the same baseline. Praximo
tokens and behavior live in the explicitly marked additive extension layer.
`packages/ui/src/typeset.css` is generated baseline too — see Prose below.

## Baseline rule

Do not customize shadcn primitives for Praximo.

- Do not add product typography, colors, spacing, motion, feedback, haptics,
  status semantics, product props, or visual variants inside
  `packages/ui/src/components/ui/**`.
- Do not change the standard shadcn semantic theme values. In particular, UI
  Lab's primary picker is useful for inspection and local drafts; it does not
  authorize a committed change to the accepted primary baseline.
- Preserve live-registry primitive source apart from the minimum technical
  TypeScript import or compiler compatibility required by this repository.
- Preserve upstream classes even when a generic local preference would choose
  differently. Product code must not "clean up" or restyle registry source.
- An exception requires an explicit human decision recorded in the governing
  issue or ADR and a focused contract test. A product need by itself is not an
  exception.

## Adding product UI

Use this order:

1. Reuse and compose installed shadcn primitives.
2. Search the live registry for an existing primitive before writing custom
   markup.
3. When Praximo needs a distinct API, behavior, or reusable composition, create
   a wrapper or composite outside `components/ui/**`, for example
   `packages/ui/src/components/feedback-button.tsx`.
4. Keep feature-specific composition in its owning application.

`className` on a primitive is for caller layout. It must not override the
primitive's colors or typography. Applications may have additive app-only CSS,
but may not override shared base tokens or copy shared primitives. A need
repeated across applications moves into `@praximo/ui`.

Status families (`success`, `warning`, `error`, and `info`), host-neutral
feedback, and product motion tokens are Praximo extensions. Keep them outside
the pure primitive source and in the separately marked CSS/component layer.

## Typography status

Semantic interface typography is intentionally deferred after the #215 reset.
The current `Heading`, `Text`, and `typographyRecipe` exports are transitional
compatibility scaffolding, not an accepted hierarchy. Do not inject them into
shadcn primitives or treat their current roles and values as design decisions.

## Prose

`packages/ui/src/typeset.css` is the second shared stylesheet. It owns block flow
inside prose — the spacing between paragraphs, lists, headings and tables — and
`styles.css` imports it after Tailwind, so every application already has it.

Use it for long-form content: a legal text, a consent pane, a rendered artifact.
Wrap the content in `.typeset` plus one preset and then write plain elements.

```tsx
<div className="typeset typeset-document text-muted-foreground">
  <p>…</p>
  <h2>…</h2>
  <div className="typeset-scroll">
    <table>…</table>
  </div>
</div>
```

Rules:

- Do not hand-space blocks inside a prose block. No `mt-*`, no `space-y-*`, no
  list `pl-*`. That spacing is `--typeset-flow`, and a contract test holds it.
- Do not apply `typographyRecipe`, `Heading`, or `Text` inside a prose block.
  Interface roles are for chrome; keep the page title and its metadata outside
  the block and let the prose own its own headings.
- Colour and layout utilities on the container are fine — `text-muted-foreground`
  for a muted reading column, a max width, a top margin.
- `typeset-scroll` wraps anything wider than the measure so it scrolls at its
  natural width instead of compressing.
- `typeset.css` is generated source. Do not hand-edit it. Regenerate it from the
  [builder](https://ui.shadcn.com/docs/typeset) if it has to change.
- The presets — `.typeset-document` and `.typeset-pane` — live in the Praximo
  extension layer of `styles.css` and set nothing but the six `--typeset-*`
  variables. Adding a third one is a design decision made in UI Lab against
  Ukrainian and Russian text in both themes, not a convenience.

`apps/client/src/features/legal/components/legal-page.tsx` is the worked example.

## Registry workflow

Run shadcn commands from `packages/ui` with bun:

```sh
bunx --bun shadcn@latest info --json
bunx --bun shadcn@latest preset resolve --json
bunx --bun shadcn@latest docs <component>
bunx --bun shadcn@latest add <component> --dry-run
bunx --bun shadcn@latest add <component> --diff <file>
```

Never fetch primitive source manually and never use `--overwrite` without
explicit approval. Review every registry diff before applying it. The accepted
result is the upstream source plus only necessary repository compatibility, not
a smart merge of Praximo styling into the primitive.

After a change, run the relevant application tests and the
`@praximo/ui` foundation tests. UI Lab must continue to present `Pure shadcn`
before `Praximo extensions`.
