# 日内交易状态卡 UI Design QA

- Date: 2026-09-16
- Scope: GC / CL / ES 卡片的本地显示隐藏与恢复；不改变偏见、方向、结构、机会、关键位置、状态、记录或统一备份格式。
- Visual truth inputs compared in the same QA pass:
  - `/Users/hongchujun/.codex/generated_images/01a079d6-c844-7fe0-b65f-ab3aedeebe71/exec-b04d8cfd-380a-41ad-82c9-d34f42ade4e1.png`
  - `/var/folders/s0/w9l5s5fd2g9903lpf2dh6mz80000gn/T/TemporaryItems/NSIRD_screencaptureui_RU95RI/截屏2026-09-16 上午9.08.23.png`
- Implementation examined: Codex in-app browser, `http://localhost:4180/#/home`, deep appearance, 1280 x 720 viewport. The browser capture is session evidence; the local URL is the reproducible implementation target.

## Acceptance checks

- Default manager is after the risk description and before the card grid. Its measured height is 48 px with no hidden cards; it stays visible even when all cards are hidden.
- Each title row exposes the compact, keyboard-focusable text control `隐藏`; it has both an accessible name and a native title. The textual control is the accepted constraint difference from the visual truth's eye-slash asset: no new asset, emoji, inline SVG, or dependency was introduced.
- Hiding CL automatically opens the manager. At 1280 x 720 it measures 112 px with its single recovery row, and GC / ES reflow into two 523 px columns with no horizontal overflow.
- The expanded row contains `CL` / `已隐藏，状态仍保留` / `恢复显示`; manager collapse and re-expand preserve the hidden list.
- Restoring CL returns the card sequence to GC → CL → ES. A refresh retained the CL hidden preference and expanded manager state. Hiding all three left the manager and all three restore controls usable; each was restored successfully.
- The independent `intraday-task-cards:v1:commodity-preferences` key contains only hidden symbols and manager expansion. Unit and production-bundle tests confirm the serialized trading workspace and records are unchanged.
- Responsive QA: at 900 px the page rendered two card columns with no cards or manager overflow; at 390 x 844 it rendered a single card column, and the manager and controls remained visible without horizontal overflow.
- Interaction QA: hide, restore, manager expand/collapse, refresh persistence, all-hidden recovery, focus return, and scroll-preserving re-render all use the existing `preserveScrollPosition` path. In-app browser console errors: none.

## Comparison and iteration record

1. The first implementation retained the fixed three-column grid after hiding CL, which left an unused third column and did not match the two-card visual truth. The renderer now assigns an explicit visible-card-count class so two cards fill two columns and one card fills its grid row; mobile overrides remain single-column.
2. The first manager copy used an explanatory second line, making its collapsed state too tall. Removing that nonessential line yields the required compact 48 px default manager while the expanded recovery row retains its explicit data-safety copy.
3. The final dark-mode comparison preserves the existing page typography, panels, borders, state colors, and card hierarchy. The new manager follows those same surface tokens instead of introducing a dominant standalone card.

## Verification

- `npm run build` passed.
- `node --check dist/app.bundle.js` passed.
- `npm test` passed after the final build.
- `git diff --check` passed.

## Final result

No P0, P1, or P2 issues remain within the authorized scope.

final result: passed
