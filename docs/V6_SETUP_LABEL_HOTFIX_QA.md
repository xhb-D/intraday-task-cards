# V6 Setup Label Hotfix QA

Date: 2026-10-09

Branch: `codex/v6-setup-label-hotfix`

Base: `002ec92b3799f465b71b2ed77c7a179dcc418850` (clean main; fetched origin/main matched before development).

## Scope

Card-only display labels, shared by new-opportunity buttons, wait/signal headings and active trade titles:

- `mtf_pb`: `MTF PB（仓位合适看5M，不合适1M+rsi）`
- `mtf_bof`: `MTF BOF（做多等收敛 做空等扫高）`

The reminder is text only. No 5M/1M/RSI decision logic was added. Stable keys, canonical Setup names, historical records, JSON/Markdown, schema, migration, persistence, research algorithms, Risk and Chime/Helper implementation are unchanged. Old Setup labels use the existing fallback. Header order and color rules are unchanged.

Cache version: `v6-setup-label-hotfix-20261009`, shared by all nine existing CSS/JS references.

## Browser evidence

Actual Codex in-app browser, isolated localhost port 4303. Only synthetic fixtures were loaded; no normal browser or real localStorage was accessed. GC contained a pending PB wait, CL a BOF signal, and ES two active independent trades (one PB, one BOF, with separate Initial Stops).

Measured DOM text Range rectangles, button geometry, computed whitespace/overflow and document scroll width. Compared 40/60 and 45/55 before selecting 45/55. Font size remains the existing 11px; line height remains 16px.

| Ratio / viewport | PB width | BOF width | PB / BOF lines | Both heights |
|---|---:|---:|---|---:|
| 40/60, desktop 1280px | 123.59px | 185.41px | 2 / 2 | 42px |
| 40/60, mobile 390px | 132.40px | 198.59px | 2 / 1 | 42px |
| **45/55, desktop 1280px and 1440px** | **139.05px** | **169.95px** | **2 / 2** | **42px** |
| **45/55, mobile 390×844** | **148.95px** | **182.05px** | **2 / 2** | **42px** |

Desktop widths match at 1280 and 1440 because the existing shell has a maximum width. At the final ratio, each of the three cards had identical button top coordinates within its Setup row and equal heights. All text Range rectangles stayed inside their buttons, overflow was visible, whitespace normal, and no ellipsis/clamping/hiding was introduced. Document horizontal overflow was false in desktop light/dark at both widths and mobile light/dark. Pending and active heading elements stayed within their cards in the desktop boundary check. Screenshots were also inspected visually.

Existing light locked long/short computed text colors remained `rgb(24, 122, 65)` / `rgb(197, 52, 69)`; dark remained `rgb(108, 239, 166)` / `rgb(255, 104, 121)`. The active long follow-position label retained the same directional green. Selected and unselected Setup classes/colors remained intact. Disabled behavior is covered by the targeted renderer test. No captured console error/warn.

Local screenshots and raw measurements:

`/Users/hongchujun/Documents/日内交易/V6-Setup-Label-Hotfix-QA-20261009/`

- `desktop-light.jpg` — 1440px, three cards, pending and active titles.
- `desktop-dark.jpg` — same layout in dark mode.
- `mobile-light.jpg` — 390×844, GC card including Setup buttons and wait heading.
- `mobile-dark.jpg` — same mobile view in dark mode.
- `layout-measurements.json` and `layout-audit.json` — actual DOM/computed-style observations.

## Tests and verification

Added 11 cases in `test/v6-setup-label.test.js`:

- `Setup reminders GC/CL/ES: exact labels and unchanged keys on two buttons` (3).
- `Setup reminder mtf_pb/mtf_bof wait/signal/position: matching heading without changing records or exports` (6).
- `Setup reminders are presentation only: canonical and legacy names stay unchanged` (1; also disabled controls).
- `Setup wrapping is card-scoped, equal-height and visible in both appearance modes` (1; shared CSS constraints, complemented by browser measurements).

Updated the previous narrow/single-line layout expectation to the newly authorized wrapping layout and updated label/cache expectations. No old business assertions were removed or weakened.

- `npm test`: **1038/1038 PASS, 0 skipped, 0 failures** (original 1027 plus 11).
- `npm run build`: PASS.
- `node --check dist/app.bundle.js`: PASS.
- `git diff --check`: PASS.
- Bundle SHA-256: `4086e5b4301b61f864587dd0124af670cc94b453edbb0fbcbb6dad3637a9f969`.

Only UI renderer, scoped layout CSS, cache references, UI tests, generated bundle and this report changed. No push, merge or deployment is part of this task. Local candidate awaits human visual acceptance.
