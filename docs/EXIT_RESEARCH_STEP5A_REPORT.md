# Exit Research V0 Step5A 本地候选交付报告

日期：2026-10-05。状态：本地实现与验证完成，等待人工验收；未部署。

1. **Branch**：`codex/exit-research-v0-step5a-ui`。
2. **Base main SHA**：`4deac7d3e70bb32f4f50a0f8438ca090554877ee`。独立 native worktree：`/Users/hongchujun/.codex/worktrees/exit-research-v0-step5a/日内交易卡片`。main 未修改。
3. **Cherry-pick**：六个指定提交按顺序无冲突整合，未回退生产文件。

| 冻结来源 | 本地 cherry-pick SHA |
| --- | --- |
| ec24ff0f733166a7654b45fd24a28014c882c820 | f24b1f4aca8f50daf18c748673060925b19dc117 |
| 3a9f27e85265867cc37afecd8358462044b9f0e3 | f9bdf968765821be295161e6d6290f2d37b5dd6b |
| 7fb6017b9a6f47874435d9dd8426fbd91fc964f7 | 90c39faa819e1aea5379a854d8c74912a812c234 |
| 037841a3c2c17dc4eed3ba4e23dc0d07bf5da797 | 3687b31cec5ed2c1c8cc9aefb642e3a9938c9d03 |
| 33ca4cf7e886001e6af63e6c14bccd981cc71798 | d582a71b5614eab5f726105dd66f0d251a621d79 |
| ee3931cd3e1920b25ecc0e836c29808c9be61576 | 2824146318061b52b9240c49b76063fe4937197a |

4. **Step5A commit SHA**：交付消息返回完整 SHA；本报告随一个独立 Step5A commit 保存，父提交为 `2824146318061b52b9240c49b76063fe4937197a`。
5. **本轮文件**：新增 `src/exit-research/ui/{store,controller,view-model,render,export}.js`、`exit-research.css`、`scripts/{research-bundle,qa-exit-workbench}.mjs`、`test/exit-research-ui.test.js`、`test/fixtures/exit-research-ui.js`、本报告/规格/计划；修改 `src/app.js`、`src/router.js`、`index.html`、`scripts/build.mjs`、`test/bundle.test.js`、生成的 `dist/app.bundle.js`。冻结研究引擎文件未修改。
6. **Router**：增加 `#/exit-research` 与导航，title 为 `Exit Research · 统一交易控制中心`。home/risk/chime/unknown 行为保留，浏览器前进/后退 PASS。app.js 仅挂载、刷新、隐藏独立容器与隔离初始化异常。
7. **Research Store V1**：独立 key `exit-research:v1`，`app: exit-research`、`schemaVersion:1`、`sequence`、`manualDecisions`、`preferences`、`settings.tradeOverrides`。决定复用 frozen 结构；偏好仅 setup/family/quality/selectedOpportunityId；设置仅逐 Opportunity 的显式 `replayHardEndAt` 与可选 `executionTickSize`。无 CSV、Bundle、records 或 Flat 持久化；严格导入校验、预览确认、CAS 防跨标签覆盖及重读恢复入口。
8. **导入流程**：只读当前 canonical V5 records；Fills/Orders/Position History 本地文件读取、冻结 parser、适配层 preflight 后原子替换内存。Flat 默认未勾选，未确认显示 `WINDOW_START_FLAT_UNCONFIRMED`；更换 Fills 重置确认；确认也先 preflight，失败不提交标志。刷新后 CSV/Bundle 清空。合成样本 4 records、4 entered、3 Initial Stop；10 Fills、10 Orders、5 Position History；显式 Flat 后 5 Closed、0 Open。
9. **Matching UI**：Setup/品种/质量过滤，matching 与研究质量分开；冻结 reconciliation / Execution QA；歧义候选可人工确认/拒绝，保存 append-only decisions。候选使用 CSV 源行号区分，账户/Fill/Order ID 不显示。导入偏好不会显示过滤范围外交易；来源事实变化保留 frozen fingerprint 阻断。
10. **Market Bundle UI**：冻结 validator，显示 Series、Role、Coverage、Source Mode；无 Bundle 仍可匹配，指标与 Replay 等待行情。导出请求使用两个冻结 planners：执行品种/合约、实际时间、pending/configured Hard End、5M/30M 与按需 detail。请求 JSON 及 Research Store JSON 均通过实际下载文件检查，Store 再导入成功。
11. **Metrics UI**：复用 frozen r-math/metrics，Realized R 不使用美元 P/L；MFE/MAE 展示确认值或区间，上界未知明确 Incomplete；2/4/6/8/10R 显示 Confirmed/Possible/Not Reached/Incomplete。完整合成 GC：Realized 8R，MFE 12R，MAE 0.5R。缺口：BLOCKED，MFE Confirmed ≥9R / Incomplete，而不是假精确值。
12. **Replay UI**：Hard End 逐交易明确输入且必须带时区，无默认值；缺失返回 `REPLAY_HARD_END_REQUIRED`，不阻断 Actual Metrics。PB 运行适用的三套 frozen policy；BOF 运行三套各自 MANUAL_ACTUAL / FIXED_INITIAL_SETUP，按同一策略成对比较，共六张卡。真实人工转换不会生成自动转换规则。缺少 tick 保持 frozen REVIEW；质量 BLOCKED/Lookahead FAIL 明确显示，不形成正式比较。
13. **Trace UI**：默认折叠；中文说明 Entry/Milestone/Stage/Protection/BOF→PB/Stop/Hard Ceiling/Hard End；可进一步展开稳定 code 与时序 payload。退出时点不确定时显示时间区间。手机展开 trace 无溢出。
14. **数据隔离证明**：canonical 操作前后真实下载的完整备份逐字节相同，8430 bytes，SHA256 `0c0d5a4445d1f5bcc01f032a76fb3cc5a31426073bb9c6303436b04641f09ffd`。Unified 仍 2，Intraday 仍 5，4 records 全部保留。46 项 UI 测试包含 canonical deepEqual；storage 写 key 仅 Research Store。27 个 frozen engine 文件逐 blob hash 一致。model/persistence/unified/holding-reference/Risk/Chime 与现有生产 CSS 对 base main diff 为空。未修改真实线上 localStorage；截图和文件全部 synthetic。
15. **测试总数**：整合后 594/594；最终 `npm test` 报 641/641 PASS，0 fail/skipped/cancelled。新增 46 项 UI/边界测试全部通过；增量总计还包含 Node 自动发现的一份 fixture 模块。测试清单见 `test/exit-research-ui.test.js`。覆盖用户列出的 route、只读、CSV/Flat、重建/匹配/歧义人工决定、Store、请求、metrics、全部适用 policy/source、trace、质量/lookahead、错误隔离及原有 Risk/Chime regression。
16. **Build**：`npm run build`、`node --check dist/app.bundle.js`、`git diff --check` 全部 PASS。无需新依赖。研究依赖保持闭包模块作用域，原生产顶层符号 guard 保留。最新实际 bundle 浏览器显示 ES 六张 READY policy、源 CSV 行 4/5，无 warn/error。
17. **Desktop light/dark 截图**：完整 IAB 交互工作台 A–G 截图及最后一次真实 bundle 截图已保存；Chrome 精确布局 fixture 1280×900，scrollWidth=1280，左右双栏与同策略并排正常。文件见下面证据表。
18. **Mobile 截图**：Chrome 同 renderer/CSS fixture 390×844，scrollWidth=390；列表/详情与 policy 上下排列；trace 展开后仍为 390。完整 IAB 工作台交互还在实际 377px 宽度验证了文件导入、设置/匹配/Replay/Store/路由。
19. **已知限制及验证口径**：Flat 是用户声明，不是工具自行证明；CSV/Bundle 重开页面须重新导入；Hard End/tick 来源仍需用户确认；没有真实行情或真实交易研究验收。准确 390×844 的检查是同源 renderer/CSS 静态布局页；Chrome 扩展缺少本地文件访问权限，未改变扩展权限，因此没有把该布局检查称为该尺寸下的完整文件导入交互验收。IAB 有后续重复下载未落盘的情况，新 QA 标签页首次下载实际落盘；未据此改写生产下载机制。Risk/Chime 路由及原有测试正常，本轮不重新验收实际声音/通知。用户禁止子代理后，后续审查、修复及 QA 全部由当前线程执行；最终为作者自审，人工验收待完成。
20. **未部署**：未 merge、未 push（含 main）、未部署 Pages；main 仍 `4deac7d3e70bb32f4f50a0f8438ca090554877ee`。未开发 Step5B/Post Exit、参数矩阵、Walk Forward、TradingView 联网、自动下载、Skill 或 AI 研究结论。完成本地 commit 后停止。

## Synthetic 浏览器证据

目录：`/Users/hongchujun/Documents/日内交易/ExitResearchStep5AQA-20261005`。截图保存在仓库外，不包含用户真实交易数据。

| 检查 | 文件 |
| --- | --- |
| A 无数据 | A-empty-desktop.jpg |
| B CSV 导入、Flat 未确认 | B-import-flat-unconfirmed.jpg |
| C 匹配列表 | C-matching-list-light.jpg |
| D READY 详情 | D-ready-detail-light.jpg |
| E 缺少 Stop 阻断 | E-blocked-stop-dark.jpg |
| E 行情缺口/Lookahead FAIL | E-market-blocked-final.jpg |
| F PB Replay | F-pb-replay-light.jpg |
| F BOF 两模式比较 | F-bof-comparison-dark.jpg |
| G 展开 trace | G-trace-expanded-dark.jpg |
| 最后实际 bundle 交互 | final-full-app-interaction.jpg |
| 准确 desktop light/dark 布局 | desktop-light-layout-1280.jpg / desktop-dark-layout-1280.jpg |
| 紧凑 desktop light/dark 视口 | desktop-light-detail-viewport.jpg / desktop-dark-detail-viewport.jpg |
| 准确手机布局 / trace | mobile-layout-390x844.jpg / mobile-trace-390x844-viewport.jpg |
| 自动几何断言 | browser-layout-qa.json |
| 四路由/历史导航 | routes-qa.json |
| 隔离验证 | isolation-qa.json / canonical-final-before.json / canonical-final-after.json |
| 下载文件 | Exit_Research_Store_V1.json / Exit_Research_Market_Request.json |

## 工程决策

逐交易显式 Hard End；可选 tick 缺省保持 REVIEW；用闭包 bundle 保留冻结模块作用域；已授权冻结规格内直接执行；用户禁止子代理后改作者自审；Chrome 准确尺寸采用同源静态布局证据。这些决定及测试 RED→GREEN 记录保存在实现计划的 Execution ledger。没有改变冻结研究算法或核心业务规则。
