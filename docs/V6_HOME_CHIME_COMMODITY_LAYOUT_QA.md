# V6 Home Chime / Commodity Layout Hotfix QA

## Candidate scope

- Branch: `codex/v6-home-chime-commodity-layout-hotfix`
- Base: `7a0a534e202dd2cd03fcf5af98a198c2e0849eec`
- Initial clean main, fetched origin/main and local main matched this base before branch creation.
- Local candidate only. No push, merge or deployment authorized or performed.
- Resource token (all nine existing versioned resources): `v6-home-chime-commodity-layout-20261009`.

## Implementation

1. `src/natural-chime/view.js`: move existing count, tags and empty nodes into one `chime-period-footer`, appended after preferences, actions and runtime/helper message. Existing slots, callback binding, configuration and scheduler remain unchanged. Footer order is count → tags → empty (only the applicable tags/empty view is visible).
2. `index.html`: add one initially hidden `#hidden-commodities` section after `#cards` and before `#history`. Existing dashboard header/count/toggle remain before cards; Risk stays after history.
3. `src/app.js`: render the existing hidden management rows into that new host; reuse the existing dashboard action handler on both mounts. Empty/collapsed host is hidden and cleared. Preference storage and trading mutations unchanged.
4. `src/capture-ui.js`: exact direction note `交易方向 小偏见方向>大偏见方向` across GC/CL/ES. Existing big bias → small bias → direction order and all color/selection rules retained.
5. Scoped CSS only adds footer containment/gap, hidden-list panel styling and focus outline. Five periods retain existing internal horizontal scrolling on narrow screens.

No schema, records, model, migration, persistence/CAS, Setup type/rule, Risk calculation, Research algorithm, Chime scheduling/backend/Helper, launchd or communication code changed.

## Automated evidence

- Baseline 1038 tests retained; 8 new tests, total **1046/1046 PASS**, fail 0, skipped 0.
- `npm run build`: PASS.
- `node --check dist/app.bundle.js`: PASS.
- `git diff --check`: PASS.
- Bundle SHA-256: `d913d51878ab995dac99f781d6e1dc3284f32cad221b0cafa9a3993faf57da0e`.

New test names:

- `Home chime footer/browser: count and existing slots follow preferences, actions and runtime messages`
- `Home chime footer/native: count and existing slots follow preferences, actions and runtime messages`
  - Footer last, count before tags, controls/messages above footer; 0/1/4/5 enabled slots; 3/5/15/30/custom 17 minutes; render does not mutate configuration; all five pause/resume callbacks retain their own slot IDs. Native disconnected/config mismatch messages retained.
- `Home hidden footer/0`, `/1`, `/2`, `/3`: `single lower list, toggle/restore/reload preserve canonical data`
  - Production bundle interaction through actual event registrations; one lower list; header contains no rows; zero/collapsed host empty/hidden; preference reload; all-hidden and restoration; Unified raw string stays byte-identical, including records/manual events, Risk and Chime.
- `Home footer DOM: title, visible cards, unique hidden mount, history, Risk follow in order`
- `Home direction note: exact new priority on all three cards; prior guidance absent`

Existing UI text assertions were updated for the authorized replacement. Frozen legacy fixtures and tests were not altered. Full regression includes Multi-Trade, independent stop/BOF events, persistence/CAS, migrations, Risk, Research and Web/Native Chime tests.

## Actual browser QA

Fresh localhost origin `http://127.0.0.1:4305`, isolated Codex in-app tab; synthetic accounts/trades only. Candidate index and all referenced CSS/JS copied byte-for-byte to a temporary QA directory outside repository. Synthetic data seeded through a QA launcher button. No normal Safari/Chrome storage or real user data accessed.

| View | Page scrollWidth | Footer order | Hidden list after cards/before history | Overflow/clipped controls |
|---|---:|---|---|---|
| Desktop 1280×1000 Light | 1280 | PASS | PASS | None |
| Desktop 1280×1000 Dark | 1280 | PASS | PASS | None |
| Desktop 1440×1000 Light | 1440 | PASS | PASS | None |
| Mobile 390×844 Light | 390 | PASS | PASS | None |
| Mobile 390×844 Dark | 390 | PASS | PASS | None |

- Desktop four tags: all on same row, each width 250.25 px. Mobile four: same row, each width 80.75 px.
- Mobile five tags (including custom 17 minutes): page width remains 390; tags clientWidth 340 / scrollWidth 362; internal scroll only. All five label scrollWidth equals clientWidth (38 px); no clipped text. Existing scroll provides access to the final toggle.
- Count is 6 px above tags. Panel footer is the final DOM child.
- Actual UI: first period restore → pause control appears → reload preserves → pause restores original; settings enable fifth custom slot, disable down to one and zero; zero reload retains count/empty state.
- Hidden list: collapse → reload collapsed; expand → reload expanded; restore CL returns CL to visible cards; hide GC/CL/ES gives 1/2/3 rows; all-hidden reload gives zero visible cards and three recoverable rows; restore all works.
- Two ES active trades show independent stops 5000/5002; BOF → PB on second trade changes only its management; revert restores BOF. Pending GC/CL states and Setup buttons remain present after hide/restore.
- Light locked LONG text `rgb(24,122,65)`, SHORT `rgb(197,52,69)`; dark LONG `rgb(108,239,166)`, SHORT `rgb(255,104,121)`. Following-position LONG remains green. Structure selections all `data-tone=neutral` with identical theme-specific neutral backgrounds.
- `#/risk`, `#/exit-research`, `#/chime`: normal page titles/content. Captured console: 0 error, 0 warn.
- Native status visual QA uses the actual candidate `initChimeView` in a separate synthetic view-only harness with DISCONNECTED + MISMATCH supplied as fixture state. No backend network, helper installation or runtime scheduling. It confirms helper prompt → count → tags, including disabled action state. Desktop message bottom 483.28 px; count top 495.28 px. This is view verification, not a new live Helper acceptance.
- Browser viewport reset, QA tab closed, local server stopped after QA.

## Screenshots and measurements

Absolute directory: `/Users/hongchujun/Documents/日内交易/V6-Home-Chime-Commodity-Layout-QA-20261009/`

- `desktop-1280-light.jpg`
- `desktop-1280-dark.jpg`
- `desktop-1440-light.jpg`
- `mobile-390-light.jpg`
- `mobile-390-dark.jpg`
- `mobile-five-periods.jpg`
- `mobile-all-hidden.jpg`
- `native-footer-light.jpg`
- `native-footer-mobile-dark.jpg`
- `browser-layout-measurements.json`
- `browser-color-checks.json`

All screenshots are actual browser captures. No generated mockups. No identified issue requiring a new human decision. Candidate awaits human visual acceptance; no production release performed.
