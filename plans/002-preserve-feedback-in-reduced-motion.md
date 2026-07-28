# 002 — Preserve non-spatial reduced-motion feedback

- **Status**: DONE
- **Commit**: fc1e24151
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 4 files, small

## Problem

The shared reduced-motion rule collapses every transition to 0.01ms. That
correctly removes movement but also erases color and opacity feedback that helps
users understand focus, selection, and state changes.

```css
/* packages/ui/src/styles.css:131 — current */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

The UI Lab's forced reduced-motion preview duplicates the same all-or-nothing
rule in `packages/ui/src/lab/ui-lab.css:3`.

## Target

Reduced motion removes spatial transforms and looping/keyframe movement while
retaining brief color/opacity comprehension feedback:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }

  [data-slot="button"],
  [data-slot="toggle"],
  [data-slot="toast-content"] {
    transition-duration: 100ms !important;
  }

  button,
  [data-slot="toggle"] {
    transform: none !important;
  }
}
```

Spatial component selectors must explicitly disable transforms/transitions:
Toast and Drawer movement is instant; native button and shared Toggle active
transforms are removed. The native `button` selector intentionally covers
cross-app business controls that do not render a shared-component `data-slot`.
Color and opacity-only transitions may remain at 100ms.

The `.reduce-motion` UI Lab preview mirrors the production media-query
behavior exactly.

## Repo conventions to follow

- Reduced-motion ownership is centralized in `packages/ui/src/styles.css`.
- UI Lab's forced mode lives in `packages/ui/src/lab/ui-lab.css` and mirrors the
  production rule for inspection.
- Stable selectors use the existing `data-slot` attributes in shared
  components. The native `button` element is the deliberate semantic exception
  for cross-app press feedback.

## Steps

1. Replace the global `transition-duration: 0.01ms` with explicit spatial
   opt-outs for `[data-slot="drawer-overlay"]`, `[data-slot="drawer-popup"]`,
   `[data-slot="toast"]`, native `button` elements, and shared toggles.
2. Retain 100ms color/opacity feedback for non-spatial states without restoring
   translate/scale movement.
3. Mirror the same behavior under `.motion-reduced` in
   `packages/ui/src/lab/ui-lab.css`.
4. Update `packages/ui/src/__tests__/foundation-contract.test.ts` and
   `ui-lab-contract.test.ts` to assert spatial opt-outs plus retained
   non-spatial feedback.

## Boundaries

- Do NOT remove focus rings, selection fills, or haptics.
- Do NOT add JavaScript media-query branches when CSS can express the behavior.
- Do NOT change business components or feature state.
- Do NOT add dependencies.
- If stable `data-slot` selectors for Drawer, Toast, or Toggle are absent, stop
  and report instead of using brittle DOM-position selectors.

## Verification

- **Mechanical**:
  `bun run --filter @praximo/ui check`,
  `bun run --filter @praximo/ui test`,
  `bun run --filter @praximo/ui lab:build`.
- **Feel check**:
  run `bun run ui:dev`; switch the lab to forced reduced motion. Confirm Drawer
  and Toast position changes are instant, button/toggle scale is absent, and
  focus/selection/color changes remain visible for 100ms. Repeat with DevTools
  `prefers-reduced-motion: reduce` and confirm forced and system modes match.
- **Done when**: spatial movement is absent in both reduced-motion modes,
  non-spatial feedback remains perceptible, and all commands pass.
