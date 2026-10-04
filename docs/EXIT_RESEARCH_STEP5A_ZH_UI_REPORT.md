# Step5A 中文界面与信息精简验收报告

基线：654c8fce9c8463d1ab7c78eb9ef7aa1dd303619f；分支：codex/exit-research-v0-step5a-ui。

## 修改范围与数据边界

仅修改 UI 映射、渲染、CSS scope、展示测试、合成 QA 夹具生成脚本和生成 bundle。本轮不改变匹配、one-to-one assignment、人工决定 API、Research Store、parser、重建、metrics、replay、lookahead 或 trace 数据。

Intraday V5、Unified V2、Research Store V1 均保持不变。src/model.js、所有冻结研究引擎、ui/store.js、ui/controller.js、ui/view-model.js、ui/export.js、Risk/Chime 和生产首页源文件相对基线没有修改。main 仍为 4deac7d3e70bb32f4f50a0f8438ca090554877ee，工作区未改；不 merge / push / deploy，不使用子代理。未跟踪 .DS_Store 保留且不提交。

## 文件

- src/exit-research/ui/labels.js：统一中文映射。
- src/exit-research/ui/render.js：中文主界面、技术折叠、按钮门控。
- exit-research.css：仅增加根容器作用域限制。
- test/exit-research-ui-labels.test.js：14 项新增展示测试。
- test/exit-research-ui.test.js：更新 4 项测试的展示文字/隐私断言；底层数据断言保留。broker ID 不出现在主界面，logicalTradeId 在技术详情中保留完整值。
- scripts/qa-exit-workbench.mjs：增加 READY / BLOCKED / 歧义静态布局夹具，全部合成数据。
- dist/app.bundle.js：重新构建。
- docs/EXIT_RESEARCH_STEP5A_ZH_UI_REPORT.md：本报告。

## 匹配候选显示

| 匹配状态 | 人工按钮 |
|---|---|
| MATCHED（自动或人工确认） | 无 |
| REVIEW_REQUIRED | 确认是这笔 / 排除这笔 |
| MATCH_AMBIGUOUS | 确认是这笔 / 排除这笔 |
| NO_MATCH | 无 |
| DATA_CONFLICT | 无，不能人工越过硬冲突 |

自动唯一匹配显示“自动匹配成功”，默认折叠“查看匹配依据”。依据包含品种/方向、HTML 与真实入场/平仓时间、时间差和一对一匹配。人工确认结果显示“人工确认匹配”，同样没有多余候选按钮。候选标题为“候选成交 1”，合约单列显示；源 CSV 行和完整 ID 放在技术详情。

## 主界面信息层级

交易事实、列表、成交核验、实际持仓表现、回放卡和数据准备区均中文化。内部字段、原始状态和原因、策略 ID、QA flags、source rows、内部时间戳统一放入默认折叠的“技术详情”。轨迹保持默认折叠，展开后显示时间、中文事件、中文阶段、已知 MFE、保护位；每条原始 payload 单独折叠。策略切换依据 event.policyId 显示 PB 或 BOF，撤销不会错误显示 PB。

主界面保留 Exit Research、GC/ES/CL、PB/BOF、MFE/MAE、HTML、Tradovate、CSV 文件名等必要名称；研究截止时间输入仍保留带时区的标准时间格式。检查的技术字段/reason code 没有在默认主界面暴露。用户手动展开技术详情后可查看稳定枚举。

## 中文映射表

### BOUNDARY_LABELS

| 内部值 | 显示名称 |
|---|---|
| WINDOW_START_FLAT_UNCONFIRMED | 尚未确认导出窗口起点为空仓，暂不重建正式成交 |
| FLAT_CONFIRMED | 已人工确认导出窗口起点为空仓 |

### COVERAGE_LABELS

| 内部值 | 显示名称 |
|---|---|
| COMPLETE | 完整 |
| INCOMPLETE | 不完整 |

### DIRECTION_LABELS

| 内部值 | 显示名称 |
|---|---|
| LONG | 做多 |
| SHORT | 做空 |

### EXIT_REASON_LABELS

| 内部值 | 显示名称 |
|---|---|
| STOP_TRIGGERED | 保护位触发 |
| STOP_GAP_THROUGH | 价格跳过保护位后退出 |
| INITIAL_STOP | 初始止损触发 |
| HARD_CEILING | 达到固定上限后退出 |
| HARD_CEILING_EXIT | 达到固定上限后退出 |
| REPLAY_HARD_END | 到达研究截止时间 |
| SOFT_CEILING | 进入高盈利保护阶段 |

### MARKET_ROLE_LABELS

| 内部值 | 显示名称 |
|---|---|
| EXECUTION_PRIMARY | 执行合约主行情 |
| EXECUTION_DETAIL | 执行合约细节行情 |
| CONTEXT | 背景市场行情 |

### MATCH_STATUS_LABELS

| 内部值 | 显示名称 |
|---|---|
| MATCHED | 已匹配 |
| REVIEW_REQUIRED | 需要人工确认 |
| MATCH_AMBIGUOUS | 存在多个可能成交 |
| NO_MATCH | 未找到对应成交 |
| DATA_CONFLICT | 成交数据有冲突 |

### MILESTONE_STATUS_LABELS

| 内部值 | 显示名称 |
|---|---|
| CONFIRMED_REACHED | 已确认达到 |
| POSSIBLE_BOUNDARY_REACHED | 可能达到 |
| NOT_REACHED | 未达到 |
| DATA_INCOMPLETE | 数据不足 |

### POLICY_LABELS

| 内部值 | 显示名称 |
|---|---|
| PB_BASELINE_V1 | PB 基准管理 V1 |
| BOF_BASELINE_V1 | BOF 基准管理 V1 |
| PB_TIGHT_GIVEBACK_V1 | PB 紧保护 V1 |
| BOF_TIGHT_GIVEBACK_V1 | BOF 紧保护 V1 |
| PB_HARD_CEILING_V1 | PB 固定上限 V1 |
| BOF_HARD_CEILING_V1 | BOF 固定上限 V1 |

### PRICE_SOURCE_LABELS

| 内部值 | 显示名称 |
|---|---|
| EXACT_EXECUTION_CONTRACT | 实际执行合约 |
| SAME_EXPIRY_LARGE_CONTRACT_PROXY | 同到期大合约代理行情 |
| CONTINUOUS_CONTRACT_PROXY | 连续合约代理行情 |
| CONTEXT_MARKET | 背景市场行情 |

### QA_STATUS_LABELS

| 内部值 | 显示名称 |
|---|---|
| PASS | 通过 |
| FAIL | 未通过 |
| WARNING | 有提示 |
| CONFLICT | 有冲突 |
| INSUFFICIENT_DATA | 数据不足 |

### QUALITY_LABELS

| 内部值 | 显示名称 |
|---|---|
| READY | 可正式比较 |
| REVIEW_REQUIRED | 可查看，但建议复核 |
| BLOCKED | 暂不能形成研究结论 |

### SETUP_LABELS

| 内部值 | 显示名称 |
|---|---|
| mtf_pb | MTF PB |
| htf_pb | MTF BOF（趋势走弱1次） |
| htf_bof | HTF BOF |

### SETUP_SOURCE_LABELS

| 内部值 | 显示名称 |
|---|---|
| MANUAL_ACTUAL | 按实际人工管理 |
| FIXED_INITIAL_SETUP | 始终按原始 Setup 管理 |
| RESEARCH_TRANSITION_RULE | 研究转换规则：暂未启用 |

### STAGE_LABELS

| 内部值 | 显示名称 |
|---|---|
| INITIAL | 初始保护 |
| RUNNER | 持有观察 |
| PROTECT | 盈利保护 |
| TARGET_REVIEW | 目标复核 |
| EXTREME | 高盈利保护 |
| SOFT_CEILING | 高盈利保护阶段 |
| HARD_CEILING | 固定上限 |

### TRACE_EVENT_LABELS

| 内部值 | 显示名称 |
|---|---|
| ENTRY | 真实入场 |
| INITIAL_STOP_ACTIVE | 初始止损生效 |
| BAR_STARTED | 开始下一根 5M，使用此前已知保护位 |
| ENTRY_BOUNDARY_IGNORED_FOR_POLICY_ACTIVATION | 入场边界不确定区间未用于策略激活 |
| MFE_UPDATED | 更新最大已确认 MFE |
| MILESTONE_REACHED | 达到 {milestone}R |
| STAGE_CONFIRMED | 确认进入保护阶段 |
| STAGE_EFFECTIVE | 管理阶段正式生效 |
| PROTECTION_CALCULATED | 计算新的保护位 |
| PROTECTION_EFFECTIVE | 新保护位生效 |
| STOP_TRIGGERED | 保护位触发退出 |
| BOF_TO_PB_MANUAL_RECORDED | 人工判断 BOF → PB |
| BOF_TO_PB_MANUAL_REVERTED | 撤销 BOF → PB，恢复 BOF 管理 |
| POLICY_SWITCH_EFFECTIVE | {setup} 管理正式生效 |
| HARD_CEILING_CONFIRMED | 确认达到固定上限 |
| HARD_CEILING_EXIT | 达到固定上限后退出 |
| REPLAY_HARD_END_EXIT | 到研究截止时间退出 |
| REPLAY_BLOCKED | 关键数据或边界条件不足，暂不能回放 |

## 验证

- npm test：655/655 PASS，0 FAIL，0 skipped；641 项原有测试加 14 项新增 UI 测试。Step1–4B 冻结测试及 Risk/Chime regression 全部通过。
- npm run build：PASS。
- node --check dist/app.bundle.js：PASS。
- git diff --check：PASS。
- 隔离的旧 renderer 对照：同一组 14 项新测试在旧 renderer 下 13 项失败（中文/门控缺失），当前版本 14/14 通过；CSS scope 独立审计另外通过。
- 5 项状态按钮测试覆盖 MATCHED、REVIEW_REQUIRED、MATCH_AMBIGUOUS、NO_MATCH、DATA_CONFLICT。
- 另外 9 项测试覆盖自动匹配依据、人工确认后隐藏、主界面字段/code 隔离、数据准备、冻结策略名称覆盖、全部 18 种 trace 事件映射及 BOF 撤销方向、MFE 上下界、错误转义/折叠、CSS scope。
- CSS 共 89 个选择器（含 comma groups 和 media 内规则），全部以 .er-workbench 为根；无裸 .card / .status / button / table / details 规则。仅修 scope，布局尺寸和样式值未重构。

## 浏览器 QA

所有截图与输入仅使用合成数据，未使用用户真实成交或真实备份。

完整应用交互 QA 在 http://127.0.0.1:4295/#/exit-research：实际导入 Fills/Orders/Position History、明确确认起点为空仓、导入行情和研究设置，核对 4 条 HTML 记录 / 5 笔已平仓成交。自动匹配无人工按钮；歧义交易显示两组按钮，确认后按钮消失。PB 结果仍为 9.6R / 10.2R / 11R，BOF 六张并排对比卡正常。29 项人工转换轨迹显示中文，默认折叠。BLOCKED 显示中文关键数据不足说明。技术详情可实际展开看到 BOF_BASELINE_V1 / STOP_TRIGGERED / PASS 等稳定 code。页面外观浅色/深色正常。首页 GC/CL/ES、Risk 和 Chime 页正常，控制台新增 error/warn 为 0。没有测试真实报时声音或通知，本轮未改变报时行为。

指定尺寸布局照片来自 Chrome 浏览器加载同一 renderWorkbench / 实际 CSS 输出的合成静态夹具（无应用脚本）；不是完整应用交互截图。完整交互另在 IAB 验证，实际尺寸 377×682。Chrome 桌面 1280×900；手机 390×844，document.scrollWidth = 390，单列研究区域 366px / 策略卡区域 340px，无横向溢出。Trace 默认折叠。手机两个 390×844 文件为浏览器页面截图的相应纵向区域，另保留完整长图。

| 场景 | 指定尺寸浏览器截图 | 完整应用交互截图 |
|---|---|---|
| A matching list / 歧义候选 | A-matching-list-desktop-light.jpg | A-candidates-interactive.jpg |
| B READY 详情 / desktop light | B-desktop-light.jpg | B-ready-interactive.jpg |
| desktop dark | B-desktop-dark.jpg | C-bof-dark-interactive.jpg |
| C BOF 对比 | C-bof-desktop-light.jpg | C-bof-interactive.jpg |
| D Trace 展开 | D-trace-desktop-light.jpg | D-trace-interactive.jpg |
| E BLOCKED 示例 | E-blocked-desktop-light.jpg | E-blocked-interactive.jpg |
| F mobile 390×844 | F-mobile-390x844.jpg / F-mobile-replay-390x844.jpg / F-mobile-full.jpg | 交互已在 377px IAB 验证 |

截图目录：[ExitResearchStep5AChineseQA-20261005](/Users/hongchujun/Documents/日内交易/ExitResearchStep5AChineseQA-20261005)。几何证据：[layout-geometry.json](/Users/hongchujun/Documents/日内交易/ExitResearchStep5AChineseQA-20261005/layout-geometry.json)。完整应用技术展开和首页回归截图同目录。

## 验收状态

本轮实现及本地验证完成，等待用户按截图人工验收。没有线上操作，不开始后续开发。
