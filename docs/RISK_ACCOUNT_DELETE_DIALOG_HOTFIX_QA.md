# Risk Account Delete Dialog Hotfix — Local Candidate QA

## Baseline and boundary

- Branch: `codex/risk-account-delete-dialog-hotfix`.
- Base: `288aa5af846f868913549a277ef26ce1245305da`.
- Fresh fetch confirmed local HEAD and origin/main both equal the base, with a clean worktree before branching.
- Local candidate only: no push, merge or deployment.
- All fixtures use synthetic accounts. No real account data, normal Safari/Chrome profile, or production localStorage was accessed.

## Root cause reproduced

On the baseline, the editor's delete button called `deleteConfirm(existing, close)` while the editor remained `activeRiskDialog`. The confirmation's `riskDialog()` call returned at the single-dialog guard. In the isolated browser, the editor remained visible and the number of confirmation buttons was zero.

A related lifecycle defect was also reproduced: Escape closed the native editor, but left the active reference behind. Clicking edit again then opened zero Risk dialogs.

## Minimal production repair

1. Close and remove the editor, synchronously releasing its active reference, before opening confirmation. Keep the single-dialog guard.
2. Register a native `close` cleanup for Escape and direct dialog closure. A delayed close from an old dialog cannot clear its successor's active reference.
3. Use the requested title, exact irreversible-deletion copy, Cancel and Confirm Delete buttons.
4. Confirmation checks that the target still exists and matches the account originally shown. Changed or deleted targets and locked controllers produce a visible error without submission.
5. Guard duplicate/reentrant confirmation and disable its button during submission. Cancel never submits.
6. Continue to use existing `deleteAccount` and injected controller/Unified CAS. Save failure remains an error, with no success message; the confirmation shows that error.

No account deletion algorithm, risk calculation, account schema, persistence/CAS implementation, Intraday V6 model, migration, Setup, Exit Research or macOS Chime Helper code changed. CSS contents are unchanged. The index's nine existing resource URLs share the updated token `risk-account-delete-dialog-hotfix-20261008`.

## Automated evidence

- `npm test`: **1022/1022 PASS, 0 skipped**, retaining all 1002 baseline tests.
- 20 added deletion interaction cases: ten scenarios on each of home compact and full Risk mounts.
- The same assertions also ran against genuine browser DOM: **20 PASS / 0 FAIL / 0 skipped**.
- Native browser runner: `test/browser/risk-account-delete.html`. It uses an in-memory Map and does not read browser localStorage.
- Reusable scenarios: `scripts/qa-fixtures/risk-account-delete-cases.js`.
- Node runner: `test/risk-account-delete.dom.test.js`.
- Existing Risk DOM assertions are byte-identical; only their shared test harness was extracted and extended with native-close event emulation and selector support.

The scenarios cover:

| Scenario (each on home and risk) | Result |
| --- | --- |
| editor → confirmation, one modal, exact copy, cancel/deepEqual/reopen, old queued-close guard | PASS |
| confirm target only, other account/balance events intact, selected fallback, Unified other sections intact, reload, repeated/reentrant confirmation commits once | PASS |
| last-account deletion and empty state | PASS |
| storage write failure, original raw bytes/state retained, no success notice | PASS |
| real `commitUnified` CAS conflict, newer raw bytes retained | PASS |
| externally deleted account safely blocked | PASS |
| externally changed account safely blocked | PASS |
| locked controller blocked before commit | PASS |
| native editor close releases guard and allows balance dialog | PASS |
| native confirmation close does not delete and permits reopening | PASS |

## Actual browser interaction / layout

Isolated localhost origin only; synthetic A and B, each with synthetic balance history. Screenshots came from the built candidate bundle.

| Layout / route | Actual flow | Result |
| --- | --- | --- |
| Desktop light, 1280×720, home | edit → delete → cancel → reopen → delete → confirm → reload | PASS; 2 accounts before/cancel, 1 B after/reload |
| Desktop dark, 1280×720, risk | edit → delete → cancel → reopen → delete → confirm | PASS; B remains |
| Mobile light, 390×844, home | edit → delete → cancel → reopen → delete → confirm | PASS; 2 before/cancel, 1 B after |
| Mobile dark, 390×844, risk | edit → delete → cancel → reopen → delete → confirm | PASS; 2 before/cancel, 1 B after |
| Full Risk last-account removal | confirm remaining B | PASS; zero cards, edit disabled |
| Native Escape | editor and confirmation Escape, then reopen | PASS |

Measured confirmation size: desktop 550×212, mobile 356×212. Mobile horizontal position 17px. Each layout had exactly one open Risk dialog. `scrollWidth === clientWidth` (desktop 548px; mobile 354px); title, full body and both buttons were visible. Screenshot inspection found no clipping or overlap. UI and native DOM test console logs contained zero error/warn entries.

Evidence directory: `/Users/hongchujun/Documents/日内交易/Risk-Account-Delete-Hotfix-QA-20261008/`:

- `baseline-blocked.jpg`
- `desktop-light.jpg`, `desktop-dark.jpg`
- `mobile-light.jpg`, `mobile-dark.jpg`
- `desktop-light-after-delete.jpg`
- `browser-measurements.json`, `native-dom-results.txt`, `console.json`, `npm-test.log`

## Final checks

- `npm run build`: PASS.
- `node --check dist/app.bundle.js`: PASS.
- `git diff --check`: PASS.
- Bundle SHA-256: `e43ba7b667b58ba69a7554207ac0797043a99194585e15d6ce8fa344638ecce0`.
- Production source diff restricted to `src/risk-manager-view.js`; index changes are cache tokens only, and bundle is generated from that source.
- No additional issue found beyond the related Escape cleanup and deletion confirmation safety gaps addressed within this request.

LOCAL CANDIDATE READY — WAITING FOR HUMAN REVIEW.
NO PUSH / NO MERGE / NO DEPLOYMENT.
