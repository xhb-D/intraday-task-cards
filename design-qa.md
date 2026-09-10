# 日内交易状态卡 UI Design QA

- Date: 2026-09-10
- Scope: only the current-state summary value `只找多`; no other direction, business rule, wording, field order, or layout changed.
- Visual truth: `/Users/hongchujun/.codex/generated_images/01a079d6-c844-7fe0-b65f-ab3aedeebe71/exec-64c36505-5b66-49c2-9e1f-ae8e7a4da494.png`
- Light implementation evidence: `/Users/hongchujun/Documents/ChatGPT/日内交易卡片/qa/implementation-long-summary-light-1280x633.png`
- Dark implementation evidence: `/Users/hongchujun/Documents/ChatGPT/日内交易卡片/qa/implementation-long-summary-dark-1280x633.png`
- Browser: isolated local Chrome, `http://127.0.0.1:4177/#/home`
- Actual content viewport: 1280 x 633 (the requested 1280 x 720 browser window has a 633 px page viewport after browser chrome).
- Reviewed scenario: GC / 无偏见 / 只找多 / 多头 / 趋势回调 / 等待 / no confirmed key position.

## Acceptance checks

- Only `direction === 'long'` renders `summary-direction-long`; `只找空` and `暂无交易方向` keep the ordinary summary rendering.
- The special value inherits `.task-summary dd` typography. The dedicated rule contains no `font-size`; its 18 px desktop, 17 px compact, and 16 px mobile sizes therefore remain exactly the parent `dd` sizes.
- The pill is limited to an inline value: 1 px theme-aware blue border, low-opacity accent background, modest 9 px accent glow, and no grid, wrapping, or card-height change.
- Light explicit mode: reviewed in the light evidence image. `只找多` uses `--text-primary`, so its dark text remains legible on the light blue pill.
- Dark explicit mode: reviewed in the dark evidence image. The blue treatment remains visually subordinate to the main `等待` state while distinct from the neutral summary values.
- System mode: reviewed with the current light system appearance and matches the explicit light result.
- Browser console: no error-level entries or unhandled runtime exceptions during the light and dark page reload/capture checks.
- Static UI contract pins the long-only render and theme-token style. `npm run build` passed; `npm test` passed 211/211; `git diff --check` passed.

## Finding and fix history

1. First pass used a hard-coded pale `#c9e0ff` foreground. Because `appearance.css` is loaded after `refinement.css`, the light follow-system page showed the blue box while the `只找多` text had insufficient contrast. This was a P1 visual-readability issue; the first-pass capture is not acceptance evidence.
2. Second pass replaced the hard-coded border, background, glow, and foreground with `--theme-accent`, `--border-primary`, `--bg-surface-secondary`, and `--text-primary`. The two implementation PNGs above are the second-pass evidence. The actual light, dark, and current system-mode renders show readable text without changing the summary font size or extending the treatment to `只找空`.

## Final result

No P0, P1, or P2 issues remain within the authorized scope.

final result: passed
