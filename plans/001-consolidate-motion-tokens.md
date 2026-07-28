# 001 — Consolidate crisp interface motion

- **Status**: DONE
- **Commit**: fc1e24151
- **Severity**: HIGH
- **Category**: Easing and duration; cohesion and tokens
- **Estimated scope**: 4 files, small

## Problem

Shared interactive components hand-type three different strong curves and the
Toast stack takes 500ms to settle. The product is a crisp practice dashboard;
the long Toast transition and near-duplicate curves make feedback feel slower
and less cohesive than the rest of the Maia baseline.

```tsx
/* packages/ui/src/components/ui/toast.tsx:46 — current */
"h-(--height) ... [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]"
```

```tsx
/* packages/ui/src/components/ui/drawer.tsx:72 — current */
"... transition-opacity duration-450 ease-[cubic-bezier(0.32,0.72,0,1)] ..."
```

```tsx
/* apps/coach/src/features/coach/components/new-client-screen.tsx:81 — current */
"ease-out transition-[color,background-color,border-color,scale] duration-100 active:scale-[0.97]"
```

## Target

Define the exact shared curves once:

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
}
```

- Toast transform and opacity transitions use `300ms var(--ease-out)`.
- Toast content uses `250ms var(--ease-out)`.
- Drawer overlay and popup use `var(--ease-drawer)`; the existing 450ms drawer
  budget remains because drawers are allowed 200–500ms.
- Coach press feedback uses `var(--ease-out)` with the existing 100ms duration
  and `scale(0.97)`.
- Do not add a motion library.

## Repo conventions to follow

- Shared cross-app CSS ownership lives in `packages/ui/src/styles.css`.
- Component variants remain Tailwind class strings in
  `packages/ui/src/components/ui/button.tsx`.
- `packages/ui/src/components/ui/drawer.tsx:72` already carries the approved
  iOS-like drawer curve; this plan names that same value instead of changing it.

## Steps

1. Add `--ease-out`, `--ease-in-out`, and `--ease-drawer` to
   `packages/ui/src/styles.css`.
2. Replace the Toast stack's 500ms curve with `300ms var(--ease-out)` and its
   content curve with `var(--ease-out)`.
3. Replace Drawer's three hand-typed curves with the appropriate shared token:
   overlay/popup use `--ease-drawer`; content opacity uses `--ease-out`.
4. Replace the five Coach `ease-out` press-feedback utility occurrences in
   `new-client-screen.tsx`, `scheduling-screen.tsx`, and `day-strip.tsx` with
   `ease-[var(--ease-out)]`.
5. Extend the shared foundation test to assert all three exact token values and
   reject the old Toast 500ms transition.

## Boundaries

- Do NOT change Drawer markup, swipe calculations, gesture behavior, or 450ms
  duration.
- Do NOT change the deliberate measured-height month transition.
- Do NOT change Day Strip's requestAnimationFrame glide.
- Do NOT add dependencies.
- If a step doesn't match the code found, stop and report instead of improvising.

## Verification

- **Mechanical**:
  `bun run --filter @praximo/ui check`,
  `bun run --filter @praximo/ui test`,
  `bun run --filter @praximo/coach check`,
  `bun run --filter @praximo/coach test`.
- **Feel check**:
  run `bun run ui:dev`; trigger and dismiss Toast repeatedly and confirm each
  reversal retargets without a restart or 500ms tail. Open/close Drawer at 10%
  playback and confirm it follows the swipe edge with the iOS-like curve.
  Press Coach language/day chips and confirm the 0.97 response is immediate.
  With reduced motion enabled, confirm movement is removed by plan 002.
- **Done when**: no hand-typed cubic-bezier remains in Toast/Drawer/Coach press
  classes, Toast settles within 300ms, and all commands pass.
