# 日内交易状态卡 UI Design QA

- Date: 2026-09-07
- Source truth: `/Users/hongchujun/.codex/generated_images/01a079d6-c844-7fe0-b65f-ab3aedeebe71/exec-d5f73922-c726-4d39-825b-7d212ef5ec67.png`
- Expanded implementation: `/Users/hongchujun/Documents/ChatGPT/日内交易卡片/qa/implementation-expanded-1280x720.jpg`
- Collapsed implementation: `/Users/hongchujun/Documents/ChatGPT/日内交易卡片/qa/implementation-collapsed-1280x720.jpg`
- Combined comparison: `/Users/hongchujun/Documents/ChatGPT/日内交易卡片/qa/comparison-collapsed-side-by-side.png`
- Browser: Codex in-app browser, isolated origin `http://127.0.0.1:3002`
- Desktop viewport: 1280 x 720
- Responsive state: three desktop cards; the reviewed GC card is the narrow-card layout
- Scenario: GC / 无偏见 / 震荡 / 只找多 / 趋势反转 / 已确认位置“3M吸收位置” / 找信号

## Visual and interaction checks

- Expanded order is preserved: selection controls, `等待 / 找信号`, current-state panel, entry action, ending actions.
- Collapsed GC retains its header, 3M marker, upward expand control, current-state panel, four current values, confirmed key position, entry action, and ending actions.
- Collapsed GC hides all controls above the current-state panel and shortens naturally; CL and ES remain expanded.
- The four visible summary labels are removed. Their semantic labels remain available to screen readers through `dt.sr-only`.
- `无偏见 / 震荡 / 只找多 / 趋势反转` are complete and readable. The confirmed position `3M吸收位置` appears below the opportunity value without a visible prefix.
- The orange `找信号` remains the strongest visual element. Summary values use the existing neutral light text treatment.
- Desktop narrow-card layout reflows the task copy and summary vertically, while the summary itself remains a stable 2 x 2 grid.
- The collapse control is a real button with an accessible name and `aria-expanded`; observed state changed from `true` to `false` and back to `true`.
- GC collapsed independently; CL and ES were unchanged.
- Final browser console log: empty. No generic error banner appeared after the fixed collapse or expand actions.
- Automated regression: `npm test` passed 46/46, including generated-bundle click and keyboard-generated click paths. `npm run build` and `git diff --check` passed.

## Finding and fix history

1. Initial implementation used the page viewport as the responsive trigger. At 1280 x 720, the approximately 344 px GC card kept a two-column task layout and truncated `趋势反转` and `3M吸收位置`. Fixed by making each card an inline-size container and reflowing the task content at a 390 px card-width boundary. Rechecked in the actual three-card desktop layout; both strings are fully visible.
2. The first collapse click raised `ReferenceError: toggleCardCollapsed is not defined` because `scripts/build.mjs` omitted the new UI-preference module. Fixed by adding the module to the existing bundle order and adding a bundle-level interaction regression. Rechecked in a fresh single browser tab; collapse and re-expand both succeeded without an error banner.
3. The final combined comparison uses unaltered crops of the approved collapsed reference and the real collapsed implementation. The reference is a wide single-card concept; the implementation crop is the required narrow three-card responsive form, so layout reflow is expected while hierarchy and content remain consistent.

final result: passed
