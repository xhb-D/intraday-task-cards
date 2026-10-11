# 实际浏览器截图与验证证据

日期：2026-10-11。Chrome 154.0.8037.99；headless；临时 loopback origin；合成记录；30 张实际截图。

**设备限制：缩小视口截图是键盘模拟，真实 iOS/Android 输入法与物理显示器变化未验收。候选不标记 FROZEN。**

[本地画廊](index.html) · [交付报告](../../V6_SETUP_EXPECTATIONS_REPORT.md) · [原始浏览器结果](results.json) · [验证清单](verification.json) · [冻结边界](frozen-boundaries.json)

| 场景 | 截图 |
| --- | --- |
| Desktop · 浅色 · 尚未入场、未填写预期 | [desktop-light-01-pending-empty.png](desktop-light-01-pending-empty.png) |
| Desktop · 浅色 · 入场预期浮动面板 | [desktop-light-02-entry-panel.png](desktop-light-02-entry-panel.png) |
| Desktop · 浅色 · 等待卡片已记录预期 | [desktop-light-03-pending-saved.png](desktop-light-03-pending-saved.png) |
| Desktop · 浅色 · 已入场、未填写预期 | [desktop-light-04-active-empty.png](desktop-light-04-active-empty.png) |
| Desktop · 浅色 · 已入场、已记录预期与跟踪 | [desktop-light-05-active-tracking.png](desktop-light-05-active-tracking.png) |
| Desktop · 浅色 · 持仓预期更新面板 | [desktop-light-06-update-panel.png](desktop-light-06-update-panel.png) |
| Desktop · 浅色 · 完整历史 | [desktop-light-07-history-panel.png](desktop-light-07-history-panel.png) |
| Desktop · 浅色 · 拖动后的位置 | [desktop-light-08-dragged.png](desktop-light-08-dragged.png) |
| Desktop · 浅色 · 关闭再打开，位置保持 | [desktop-light-09-reopened-position.png](desktop-light-09-reopened-position.png) |
| Desktop · 浅色 · 新 Setup 研究分类待确认 | [desktop-light-10-research-classification-pending.png](desktop-light-10-research-classification-pending.png) |
| Desktop · 深色 · 尚未入场、未填写预期 | [desktop-dark-01-pending-empty.png](desktop-dark-01-pending-empty.png) |
| Desktop · 深色 · 入场预期浮动面板 | [desktop-dark-02-entry-panel.png](desktop-dark-02-entry-panel.png) |
| Desktop · 深色 · 等待卡片已记录预期 | [desktop-dark-03-pending-saved.png](desktop-dark-03-pending-saved.png) |
| Desktop · 深色 · 已入场、未填写预期 | [desktop-dark-04-active-empty.png](desktop-dark-04-active-empty.png) |
| Desktop · 深色 · 已入场、已记录预期与跟踪 | [desktop-dark-05-active-tracking.png](desktop-dark-05-active-tracking.png) |
| Desktop · 深色 · 持仓预期更新面板 | [desktop-dark-06-update-panel.png](desktop-dark-06-update-panel.png) |
| Desktop · 深色 · 完整历史 | [desktop-dark-07-history-panel.png](desktop-dark-07-history-panel.png) |
| Desktop · 深色 · 拖动后的位置 | [desktop-dark-08-dragged.png](desktop-dark-08-dragged.png) |
| Desktop · 深色 · 关闭再打开，位置保持 | [desktop-dark-09-reopened-position.png](desktop-dark-09-reopened-position.png) |
| Desktop · 深色 · 新 Setup 研究分类待确认 | [desktop-dark-10-research-classification-pending.png](desktop-dark-10-research-classification-pending.png) |
| Mobile · 浅色 · 320×844 底部抽屉 | [mobile-light-320-drawer.png](mobile-light-320-drawer.png) |
| Mobile · 浅色 · 375×844 底部抽屉 | [mobile-light-375-drawer.png](mobile-light-375-drawer.png) |
| Mobile · 浅色 · 关闭后背景滚动位置恢复 | [mobile-light-390-closed-scroll-restored.png](mobile-light-390-closed-scroll-restored.png) |
| Mobile · 浅色 · 390×844 底部抽屉 | [mobile-light-390-drawer.png](mobile-light-390-drawer.png) |
| Mobile · 浅色 · 缩小视口模拟键盘；真实输入法未验证 | [mobile-light-390-reduced-viewport-keyboard-simulation.png](mobile-light-390-reduced-viewport-keyboard-simulation.png) |
| Mobile · 深色 · 320×844 底部抽屉 | [mobile-dark-320-drawer.png](mobile-dark-320-drawer.png) |
| Mobile · 深色 · 375×844 底部抽屉 | [mobile-dark-375-drawer.png](mobile-dark-375-drawer.png) |
| Mobile · 深色 · 关闭后背景滚动位置恢复 | [mobile-dark-390-closed-scroll-restored.png](mobile-dark-390-closed-scroll-restored.png) |
| Mobile · 深色 · 390×844 底部抽屉 | [mobile-dark-390-drawer.png](mobile-dark-390-drawer.png) |
| Mobile · 深色 · 缩小视口模拟键盘；真实输入法未验证 | [mobile-dark-390-reduced-viewport-keyboard-simulation.png](mobile-dark-390-reduced-viewport-keyboard-simulation.png) |

正常操作新增 console error/warn 为 0；故意注入的 quota/readback 失败有 4 条预期错误诊断，完整保存在 results.json。

自动化日志：[automated-tests.log](automated-tests.log)。构建日志：[build.log](build.log)。两份 synthetic 备份为 UI 下载的合成数据。

浏览器脚本：`scripts/qa-v6-expectations.mjs`。可用现有 Playwright 模块及系统 Chrome 重跑；输出默认覆盖本证据目录，复核时建议传入新的输出目录。

日志保留全部输出内容，仅移除行尾空白和末尾多余空行，以通过仓库 Diff Check。
