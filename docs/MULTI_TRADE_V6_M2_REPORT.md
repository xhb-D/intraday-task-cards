# Multi-Trade V6 M2 Implementation Report

## Candidate identity

| Item | Result |
| --- | --- |
| Branch | `codex/multi-trade-v6-m2-capture-ui` |
| Base M1 | `b6cc7e8eba910b224f4fb3c98535e308e44fcc16` |
| Production main reference | `c4b97243cee5fd23bbea4ecb83a0568f22b25a78` unchanged |
| Candidate commit | Read the local branch HEAD; the completion response supplies its full SHA |
| Final bundle SHA-256 | `d47c6fafb6314e85e9bfb477ca1736f220380b97317d63c49224c5b6b2ad0e33` |
| M1 bundle SHA-256 | `7372cfb300effc6d5283683b610675900fdd87f133e756203d2cd26176ac2a6c` |
| Full tests | **787/787 PASS**, 0 failed/skipped/todo |
| New M2 focused tests | **37/37 PASS**; existing 750 retained |
| Build / bundle syntax / diff check | PASS |
| Publication | No push, merge or deployment |

## Requested implementation results

| Requirement | Evidence/result |
| --- | --- |
| Production V6 wiring | `app.js` uses the scoped `intradayV6` facade and the new capture services/renderer. Legacy production persistence/startup modules are excluded from the build. No card opportunity or second active cache in runtime state. |
| Startup migration | Original V3→V4→V5 migration precedes frozen M1 V5→V6. Explicit boundary time. V3 rules-upgrade facts/audit, V4 Capture initialization and V5 history/event facts preserved. |
| Persistence | Exact pre-upgrade raw snapshot/readback, repeated raw comparison, canonical V6 readback validation, conditional rollback. Snapshot quota/readback, canonical quota/readback and CAS injection all fail closed. |
| Multi-trade UI | Compact independent Trade rows plus always-present new opportunity. Same Setup may register again. Bias/structure editable, registration snapshots immutable; effective direction locked/inherited. |
| Initial Stop | Per-ID record/correct; A 90→89 and B 92 remain independent. Append-only original event retained. Stop editor and post-save focus target the record's encoded DOM identity. |
| BOF→PB | Browser verifies two BOF records, A becomes PB while B stays BOF; undo changes only A. Frozen range values unchanged. |
| Single exit | One confirmation, UNKNOWN default; STOP_EXIT only affects the selected trade. No execution price/time/order identity fabricated. |
| Manual flatten | One frozen model call; common group/time, revision +1; every target preflighted. Distinct confirmation. Cancel is a no-op. |
| Pending after flatten | Browser confirms A+C closed, D still wait after reload. Automated test also asserts exact pending identity survives. |
| History/delete | Multiple active GC rows; active/pending rows show —, ended rows retain delete. Forged active deletion is rejected by the frozen model with unchanged canonical raw. |
| JSON/Markdown | Actual system downloads verified. V6 full backup has 2 active + pending, independent stops, complete correction/conversion chain and STOP_EXIT metadata. Markdown has two active rows and both effective stops. Combined automated roundtrip retains recovery audit, flatten group, four-event stop/management chain, 2 active + pending. |
| Reload | Both real page reload and fresh current-bundle harness derive active/pending solely from persisted records. |
| CAS stale targets | Exact automated scenario: Tab B opens flatten for A; Tab A enters B; B confirms without a delivered storage event → no write and both remain active. Real two-tab final-bundle QA locks stale confirmation and requires reload. |
| Blocked migration UI | Chinese blocking page and concrete reason; no fresh-start bypass; original raw download verified byte-for-byte against the synthetic seed raw. No migration candidate returned on conflict/zoneDraft/timeline/second truth failures. |
| Exit Research | Route opens with V6; header says read-only V6. Overlapping captures are BLOCKED with Chinese capability limitation and no false MATCHED. Nonoverlap synthetic results equal the frozen V5 results apart from schema display. Canonical inputs unchanged. |
| Risk / Chime | Complete legacy regression retained; browser routes render normally; capture actions preserve both sections. The carried-forward Risk validator body is byte-identical to the legacy body. No Risk/Chime model edits. |
| Human decisions | No new architecture decision required. M2 visual acceptance and the already specified real V5 backup dry-run remain pending. No real-data test or release claim. |

## Test coverage

New file: `test/multi-trade-v6-capture.test.js` (37 named tests).

- Wiring/frozen artifact provenance, strict V6 writes/reload, repeated Setup and immutable snapshots.
- V5 wait/signal/position startup, missing active recovery, conflicts, nonempty drafts, reversed timeline and second truth rejection.
- Snapshot quota/readback, canonical quota/readback, concurrent replacement, no migrated-memory success on failure.
- V3 and V4 original migration chain, migration determinism, explicit time boundary, rejection of V5 production writes.
- Full backup/import preview, Markdown, combined events/audit/flatten-group roundtrip.
- Actual current-bundle per-ID actions, cancel/default exit/single exit/flatten/pending/history/delete/focus identities, reload and hide/collapse safety.
- Two-tab stale flatten without storage event delivery, save quota without success announcement.
- Detached Exit Research overlap gate, nonoverlap frozen comparison, and Risk/Chime section isolation.

Commands executed after the final source changes:

```text
npm test                                      787/787 PASS
npm run build                                 PASS
node --check dist/app.bundle.js                PASS
git diff --check                              PASS
node --test test/multi-trade-v6-capture.test.js 37/37 PASS
```

Logs retained locally in `/private/tmp/m2-final-tests.log`, `/private/tmp/m2-focused-final.log`. Build is deterministic and the final bundle hash above is recorded from actual output.

## Regression phase alignment

No legacy domain assertions or golden fixture facts were removed, skipped or weakened. The M1 isolation assertions cannot describe M2's authorized production wiring. Their source/bundle checks now use frozen M1 artifacts, and the current production bundle has new M2 runtime checks. Old V5-specific UI/layout assertions still run against the same M1 UI bytes; current V6 actions are tested separately.

`test/fixtures/frozen-m1/manifest.json` records the exact M1 base and SHA-256 of the old bundle, app source, build source and research linker. All were compared with `git show b6cc7e8…:<path>` and byte-equal. They are test-only and never loaded into production. The bundle resource version expectation was updated for M2; strict classic-bundle/cache-version assertions remain.

49 protected tracked source files were compared byte-for-byte with M1: frozen V6 domain/migration/queries/validation; legacy model/persistence/startup; Risk/Chime; and non-UI Exit Research engines. All identical. Step2–4B algorithms, Research Store V1 and Step5A controller/store/labels/export are not changed. Only the read-only research input adapter, view-model wiring and schema/capability presentation changed.

## Browser QA and artifact inventory

Synthetic-only isolated origin: `http://127.0.0.1:4276/`. No production origin, real browser data or real Tradovate samples were read. The temporary synthetic seed page is removed from the repository before commit.

Performed real interactions: none→PB→signal→entry; repeated Setup; two independent stops and correction; BOF conversion/undo isolation; single STOP_EXIT; simultaneous holdings with a third pending; flatten preserving pending and reload; real JSON download→file chooser→import preview→restore; multiple active history rows/no active delete; V5 startup, missing-record recovery, blocked startup/raw download; four routes; desktop light/dark and mobile 0/1/2+pending/3+pending. Final candidate browser sessions have no app console error/warn. An early cached older candidate logged expected stale-write diagnostics; final resource version and final-bundle CAS recheck are clean.

Actual mobile measurements: `innerWidth=390`, `innerHeight=844`, document `scrollWidth=390` for 0/1/2+pending/3+pending. No page horizontal overflow. Exit and flatten buttons are distinct and at least 36px high on mobile. Desktop measurements at 1440px give document width 1440px and 344px per card. Trade rows are about 161–172px on desktop; height grows by one compact row per independent trade, with the pending panel separate. Three holdings plus pending measured about 1216px total card height; it remains an ordinary vertical list rather than compressing controls.

The browser viewport capability binds to the selected tab when acquired. After multi-tab QA it was reacquired for the mobile tab, and actual 390×844 dimensions were verified before the final mobile screenshots. No screenshot is accepted as mobile merely from its filename.

Artifacts live outside production source at:
`/Users/hongchujun/Documents/日内交易/Multi-Trade-V6-M2-QA/`

| Requested screenshot | File |
| --- | --- |
| A zero holding/new region | `A-none.jpg` |
| B one holding/new region | `B-one-active.jpg`, `desktop-one-light.jpg` |
| C two holdings dark | `C-two-active-dark.jpg` |
| D two holdings + pending dark | `D-two-plus-pending-dark.jpg` |
| Desktop light major state | `desktop-two-plus-pending-light.jpg` |
| E single exit dialog | `E-single-exit.jpg` |
| F flatten dialog | `F-flatten.jpg` |
| G blocked migration | `G-migration-blocked.jpg` |
| H GC active history rows | `H-history-active.jpg` |
| I mobile 390×844 two + pending | `I-mobile-two-plus-pending.jpg` |
| J mobile 390×844 three + pending | `J-mobile-three-plus-pending.jpg` |
| Additional mobile 0/1/2 | `mobile-zero.jpg`, `mobile-one.jpg`, `I-mobile-two-active.jpg` |
| Stale flatten dialog | `CAS-stale-flatten.jpg` |

Downloaded artifacts: `two-active-plus-pending.json` (the actual JSON used in file-chooser restore), `final-v6-backup.json`, `final-records.md`, `blocked-original-raw.json`. Original system downloads retained; none are committed to production. Raw blocking export equals the original minified seed bytes exactly. Full JSON readback passes the production Unified/V6 validators.

## Changed files

Production: `src/app.js`, `src/capture-ui.js`, `src/capture-persistence.js`, `src/capture-unified.js`, `src/intraday-v6/index.js`, `src/exit-research/ui/capture-adapter.js`, `src/exit-research/ui/view-model.js`, `src/exit-research/ui/render.js`, `scripts/build.mjs`, `scripts/v6-bundle.mjs`, `index.html`, `refinement.css`, `dist/app.bundle.js`.

Tests/provenance: `test/multi-trade-v6-capture.test.js`, `test/multi-trade-v6-model.test.js`, `test/research-capture-ui.test.js`, `test/ui-preferences.test.js`, `test/bundle.test.js`, five files under `test/fixtures/frozen-m1/`.

Documentation: this report and `docs/MULTI_TRADE_V6_M2_SPEC.md`. The pre-existing `.DS_Store` is not included.

M2 IMPLEMENTATION COMPLETE
NO PUSH
NO MERGE
NO DEPLOY
WAITING FOR HUMAN REVIEW
