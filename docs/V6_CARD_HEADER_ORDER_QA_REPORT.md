# V6 card header UI hotfix

Base: `c5236bd5164f844c975e08c0843f59ec59d2a5b6`.
Branch: `codex/v6-card-header-order-hotfix`.

The base V6 DOM already placed bias, structure, and direction in that order.
This candidate preserves that order and adds explicit tests for all three symbols
in none/wait/signal/position states. It changes only the visible structure title
and its group accessible name to `HTF结构`, and the inline direction title to
`交易方向 HTF方向>缺口方向>MTF方向`. The renderer escapes `>` as `&gt;`.
No business controls, action keys, state values, or direction-lock rules changed.

Existing CSS fits the shorter labels without further changes. All color CSS is
byte-identical to the base. The nine static asset query versions are uniformly
`v6-card-header-hotfix-20261006`, with corresponding cache tests updated.

## Browser verification

Reused the isolated synthetic seed-page/full-bundle QA workflow on two fresh
loopback origins: candidate port 4284 and base port 4285. Neither origin contains
real user data. Identical fixtures cover GC wait/long, CL signal/short, and ES
position/long with an Initial Stop and BOF management controls.

| Viewport | Theme | GC / CL / ES checks | Height change vs base |
| --- | --- | --- | --- |
| 1280×1000 | light | PASS | 0px / 0px / 0px |
| 1280×1000 | dark | PASS | 0px / 0px / 0px |
| 390×844 | light | PASS | 0px / 0px / 0px |
| 390×844 | dark | PASS | 0px / 0px / 0px |

Actual DOM and computed-style checks verify ascending field positions, exact
titles, single-line labels (14–14.5px high), no title/button/document horizontal
overflow, aligned button rows, and holdings/new-opportunity sections remaining
below the header. All selected/unselected/disabled button color values and
locked/holding direction text colors match the corresponding base fixture.
No console error/warn occurred in either browser tab.

Screenshots and layout evidence are outside the repository:
`/Users/hongchujun/Documents/日内交易/V6-Card-Header-QA/`
(`desktop-light.jpg`, `desktop-dark.jpg`, `mobile-light.jpg`, `mobile-dark.jpg`,
`layout-evidence.json`). Mobile screenshots are exactly 390×844.

## Automated verification

- 13 added header tests: 3 symbols × 4 lifecycle states plus production bundle labels.
- Existing inline-title and resource-version tests updated for the accepted wording.
- `npm test`: 841/841 PASS, 0 skipped.
- `npm run build`: PASS.
- `node --check dist/app.bundle.js`: PASS.
- `git diff --check`: PASS.

No schema, records, migration, persistence/CAS, multi-trade, Initial Stop,
BOF conversion/undo, exports, Setup rules, research algorithms, Risk, or Chime logic changed.
No frozen legacy fixtures changed. Local candidate only: no push, merge, or deployment.
