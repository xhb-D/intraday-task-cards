# V6 F01–F04 修复验证证据

原候选：`eb80e9ace0784a40beacef2e870e6e821b026f58`；新候选见本轮交付消息。

**1175/1175 自动化测试通过；26 + 20 = 46 组实际 Chrome 检查通过；60 张截图。**

全部为独立 loopback origin、临时浏览器 profile、合成记录。before 截图来自原候选的只读 Git archive；after 和 regression 来自本轮新源码生成的 bundle。截图展示人工 HTML 记录，不能视为券商成交证明。

- [修复报告](../../V6_SETUP_EXPECTATIONS_REMEDIATION_REPORT.md)
- [恢复说明](../../V6_EXPECTATIONS_RECOVERY.md)
- [完整自动化日志](automated-tests.log) / [初始回归 RED](initial-red.log) / [构建日志](build.log)
- [冻结边界](frozen-boundaries.json) / [验证摘要](verification.json) / [文件清单](changed-files.txt) / [哈希](sha256-manifest.json)
- [浏览器画廊](index.html)

正常场景 console error/warn 为 0。原回归故意注入 quota/readback 产生 4 条预期诊断，保留在 regression/results.json。真实移动输入法/触摸、物理显示器、原生工具栏缩放未验收；缩小视口和 CSS zoom 只作为模拟。没有在 Excel/Sheets 中执行公式。

日志仅去除行尾空白与末尾多余空行，保留完整测试输出。CSV 下载原件保留 BOM 与 CRLF；Diff Check 用 cr-at-eol 识别这些合法 CSV 行尾，未改写下载内容。自动化日志的 duration 是该次运行的实际值。下载文件均为合成测试数据，可用恢复脚本只读复核。

## 定向修复与原候选对照

[targeted/results.json](targeted/results.json) · 20 组 · 30 张。

- light: BOF→SPB/CPB UI, immutable original, A/B isolation, no reverse, draft and reload PASS
- light: ended/canceled/invalid archive query, no hard delete, default read-only PASS
- light: equal-millisecond UI order and canonical unchanged PASS
- light: backup/fresh archive retention guard PASS (restore UI checked)
- light: actual safe CSV download and exact identity decoding PASS
- light: actual full Unified + independent Research Store download/blank-context restore/read-only verification PASS
- dark: BOF→SPB/CPB UI, immutable original, A/B isolation, no reverse, draft and reload PASS
- dark: ended/canceled/invalid archive query, no hard delete, default read-only PASS
- dark: equal-millisecond UI order and canonical unchanged PASS
- dark: backup/fresh archive retention guard PASS (restore UI checked)
- dark: actual safe CSV download and exact identity decoding PASS
- dark: actual full Unified + independent Research Store download/blank-context restore/read-only verification PASS
- light/390: both BOF management switches usable within viewport PASS
- light/390: archive query, drawer, no root overflow, close scroll PASS
- light/320: both BOF management switches usable within viewport PASS
- light/320: archive query, drawer, no root overflow, close scroll PASS
- dark/390: both BOF management switches usable within viewport PASS
- dark/390: archive query, drawer, no root overflow, close scroll PASS
- dark/320: both BOF management switches usable within viewport PASS
- dark/320: archive query, drawer, no root overflow, close scroll PASS

逐图索引：

- [light-before-home-ended-list.png](targeted/light-before-home-ended-list.png) — 原候选对照
- [light-before-equal-ms-order.png](targeted/light-before-equal-ms-order.png) — 原候选对照
- [light-after-home-current-only.png](targeted/light-after-home-current-only.png) — 新候选定向验证
- [light-after-bof-to-spb.png](targeted/light-after-bof-to-spb.png) — 新候选定向验证
- [light-after-bof-to-cpb.png](targeted/light-after-bof-to-cpb.png) — 新候选定向验证
- [light-after-archive-query.png](targeted/light-after-archive-query.png) — 新候选定向验证
- [light-after-archive-readonly-history.png](targeted/light-after-archive-readonly-history.png) — 新候选定向验证
- [light-after-equal-ms-order.png](targeted/light-after-equal-ms-order.png) — 新候选定向验证
- [light-after-two-store-recovery.png](targeted/light-after-two-store-recovery.png) — 新候选定向验证
- [dark-before-home-ended-list.png](targeted/dark-before-home-ended-list.png) — 原候选对照
- [dark-before-equal-ms-order.png](targeted/dark-before-equal-ms-order.png) — 原候选对照
- [dark-after-home-current-only.png](targeted/dark-after-home-current-only.png) — 新候选定向验证
- [dark-after-bof-to-spb.png](targeted/dark-after-bof-to-spb.png) — 新候选定向验证
- [dark-after-bof-to-cpb.png](targeted/dark-after-bof-to-cpb.png) — 新候选定向验证
- [dark-after-archive-query.png](targeted/dark-after-archive-query.png) — 新候选定向验证
- [dark-after-archive-readonly-history.png](targeted/dark-after-archive-readonly-history.png) — 新候选定向验证
- [dark-after-equal-ms-order.png](targeted/dark-after-equal-ms-order.png) — 新候选定向验证
- [dark-after-two-store-recovery.png](targeted/dark-after-two-store-recovery.png) — 新候选定向验证
- [mobile-light-390-bof-management.png](targeted/mobile-light-390-bof-management.png) — 新候选定向验证
- [mobile-light-390-archive.png](targeted/mobile-light-390-archive.png) — 新候选定向验证
- [mobile-light-390-archive-drawer.png](targeted/mobile-light-390-archive-drawer.png) — 新候选定向验证
- [mobile-light-320-bof-management.png](targeted/mobile-light-320-bof-management.png) — 新候选定向验证
- [mobile-light-320-archive.png](targeted/mobile-light-320-archive.png) — 新候选定向验证
- [mobile-light-320-archive-drawer.png](targeted/mobile-light-320-archive-drawer.png) — 新候选定向验证
- [mobile-dark-390-bof-management.png](targeted/mobile-dark-390-bof-management.png) — 新候选定向验证
- [mobile-dark-390-archive.png](targeted/mobile-dark-390-archive.png) — 新候选定向验证
- [mobile-dark-390-archive-drawer.png](targeted/mobile-dark-390-archive-drawer.png) — 新候选定向验证
- [mobile-dark-320-bof-management.png](targeted/mobile-dark-320-bof-management.png) — 新候选定向验证
- [mobile-dark-320-archive.png](targeted/mobile-dark-320-archive.png) — 新候选定向验证
- [mobile-dark-320-archive-drawer.png](targeted/mobile-dark-320-archive-drawer.png) — 新候选定向验证

## 原 26 组浮动面板与功能回归

[regression/results.json](regression/results.json) · 26 组 · 30 张。

- light: drag/close/reopen/reload PASS
- light: draft keep/discard, background trade/Chime rerender, A/B isolation PASS
- light: resize/zoom/reclamp/reset PASS
- light: quota failure preserves draft/canonical PASS
- light: actual readback mismatch rollback/draft PASS
- light: real dual-tab CAS/lock PASS
- light: closed history/single exit/flatten PASS
- light: actual JSON download/restore PASS
- light: routes PASS
- dark: drag/close/reopen/reload PASS
- dark: draft keep/discard, background trade/Chime rerender, A/B isolation PASS
- dark: resize/zoom/reclamp/reset PASS
- dark: quota failure preserves draft/canonical PASS
- dark: actual readback mismatch rollback/draft PASS
- dark: real dual-tab CAS/lock PASS
- dark: closed history/single exit/flatten PASS
- dark: actual JSON download/restore PASS
- dark: routes PASS
- light/390: drawer/save/close scroll PASS
- light/390: reduced viewport simulation PASS; real OS virtual keyboard NOT VERIFIED
- light/375: drawer/save/close scroll PASS
- light/320: drawer/save/close scroll PASS
- dark/390: drawer/save/close scroll PASS
- dark/390: reduced viewport simulation PASS; real OS virtual keyboard NOT VERIFIED
- dark/375: drawer/save/close scroll PASS
- dark/320: drawer/save/close scroll PASS

逐图索引：

- [desktop-light-01-pending-empty.png](regression/desktop-light-01-pending-empty.png) — 新候选原功能回归
- [desktop-light-02-entry-panel.png](regression/desktop-light-02-entry-panel.png) — 新候选原功能回归
- [desktop-light-03-pending-saved.png](regression/desktop-light-03-pending-saved.png) — 新候选原功能回归
- [desktop-light-08-dragged.png](regression/desktop-light-08-dragged.png) — 新候选原功能回归
- [desktop-light-09-reopened-position.png](regression/desktop-light-09-reopened-position.png) — 新候选原功能回归
- [desktop-light-04-active-empty.png](regression/desktop-light-04-active-empty.png) — 新候选原功能回归
- [desktop-light-06-update-panel.png](regression/desktop-light-06-update-panel.png) — 新候选原功能回归
- [desktop-light-07-history-panel.png](regression/desktop-light-07-history-panel.png) — 新候选原功能回归
- [desktop-light-05-active-tracking.png](regression/desktop-light-05-active-tracking.png) — 新候选原功能回归
- [desktop-light-10-research-classification-pending.png](regression/desktop-light-10-research-classification-pending.png) — 新候选原功能回归
- [desktop-dark-01-pending-empty.png](regression/desktop-dark-01-pending-empty.png) — 新候选原功能回归
- [desktop-dark-02-entry-panel.png](regression/desktop-dark-02-entry-panel.png) — 新候选原功能回归
- [desktop-dark-03-pending-saved.png](regression/desktop-dark-03-pending-saved.png) — 新候选原功能回归
- [desktop-dark-08-dragged.png](regression/desktop-dark-08-dragged.png) — 新候选原功能回归
- [desktop-dark-09-reopened-position.png](regression/desktop-dark-09-reopened-position.png) — 新候选原功能回归
- [desktop-dark-04-active-empty.png](regression/desktop-dark-04-active-empty.png) — 新候选原功能回归
- [desktop-dark-06-update-panel.png](regression/desktop-dark-06-update-panel.png) — 新候选原功能回归
- [desktop-dark-07-history-panel.png](regression/desktop-dark-07-history-panel.png) — 新候选原功能回归
- [desktop-dark-05-active-tracking.png](regression/desktop-dark-05-active-tracking.png) — 新候选原功能回归
- [desktop-dark-10-research-classification-pending.png](regression/desktop-dark-10-research-classification-pending.png) — 新候选原功能回归
- [mobile-light-390-drawer.png](regression/mobile-light-390-drawer.png) — 新候选原功能回归
- [mobile-light-390-closed-scroll-restored.png](regression/mobile-light-390-closed-scroll-restored.png) — 新候选原功能回归
- [mobile-light-390-reduced-viewport-keyboard-simulation.png](regression/mobile-light-390-reduced-viewport-keyboard-simulation.png) — 新候选原功能回归（视口模拟）
- [mobile-light-375-drawer.png](regression/mobile-light-375-drawer.png) — 新候选原功能回归
- [mobile-light-320-drawer.png](regression/mobile-light-320-drawer.png) — 新候选原功能回归
- [mobile-dark-390-drawer.png](regression/mobile-dark-390-drawer.png) — 新候选原功能回归
- [mobile-dark-390-closed-scroll-restored.png](regression/mobile-dark-390-closed-scroll-restored.png) — 新候选原功能回归
- [mobile-dark-390-reduced-viewport-keyboard-simulation.png](regression/mobile-dark-390-reduced-viewport-keyboard-simulation.png) — 新候选原功能回归（视口模拟）
- [mobile-dark-375-drawer.png](regression/mobile-dark-375-drawer.png) — 新候选原功能回归
- [mobile-dark-320-drawer.png](regression/mobile-dark-320-drawer.png) — 新候选原功能回归
