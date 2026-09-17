# Accessibility pilot task

## Goal

Synchronize the pressed/selected state of toggle-like buttons with the standard `aria-pressed` attribute.

## Acceptance criteria

1. Buttons whose selected state changes dynamically expose matching `aria-pressed="true"` or `"false"`.
2. Initial HTML state is accurate before JavaScript runs.
3. A small reusable helper is preferred over scattered string writes.
4. Focused tests run with `node --test tests/accessibility-state.test.mjs`.
5. No visible UI, climate calculation, terrain, map, or styling behavior changes.

## Allowed implementation paths

- `index.html`
- `js/main.js`
- `js/accessibility.js`
- `tests/accessibility-state.test.mjs`

## Boundaries

Two cycles maximum. Claude implements and tests. ChatGPT independently audits. No merge without user approval.
