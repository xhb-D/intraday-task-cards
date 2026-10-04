# Exit Research V0 / Step 3 完成报告

本轮仅按附件授权实现 reconciliation；完成一个本地 commit 后停止，等待人工验收，未自行 FROZEN。

1. **分支**：codex/exit-research-v0-step3。复用本任务已有隔离 worktree，创建新分支，不改旧 Step2 分支或 main。
2. **Base**：3a9f27e85265867cc37afecd8358462044b9f0e3；实际核对 frozen 源码、规范、报告和测试，基线373/373。
3. **Step3 commit**：完整 SHA 在最终交付消息列出，也可由该分支 git rev-parse HEAD 核对；本报告与实现同一 commit，不用额外 commit 回写自身 SHA。
4. **文件**：仅新增10个文件：src/exit-research/{symbol-map,research-common,manual-matches,reconciliation,execution-qa,research-trade}.js、scripts/qa-exit-reconciliation.mjs、test/exit-reconciliation.test.js、docs/EXIT_RESEARCH_STEP3_SPEC.md、本报告。没有修改已有文件或依赖。
5. **Symbol mapping**：GC→MGC、ES→MES、CL→MCL。保留 researchFamily、原 contextSymbol、executionProduct、精确 executionContract，不制造连续合约名。
6. **候选**：品种族/方向一致、closed、无阻断执行 flag 或 QA conflict； enteredAt 对 Fills-derived entryStartedAt 做绝对毫秒差。Entry ≤2分钟 strong，>2且≤10分钟 review，>10分钟排除普通候选。registeredAt 仅保存。Exit 相同2/10分钟可配置分档，缺 exit review，>10分钟 conflict；不凭 Entry 单独 MATCHED。
7. **One-to-one**：人工锁定/拒绝后，按整个 bipartite connected component 枚举全部合法部分 assignment。词典序目标：最多匹配→最多双强→最多 exit strong→最多 entry strong→最小总 entry delta→最小总 exit delta。ID 不用于证据打破平局；同等最优解有多个 ID 或 ID/null → ambiguous。8节点/200000步骤上限，超限整个组件转人工复核，无贪心回退。
8. **Matching 状态**：MATCHED/REVIEW_REQUIRED/MATCH_AMBIGUOUS/NO_MATCH/DATA_CONFLICT；输出明确 matchingReasons、entryDeltaMs/exitDeltaMs。全部 reason 及其映射见规范，包括 ENTRY_STRONG、EXIT_STRONG、UNIQUE_ONE_TO_ONE、EQUAL_GLOBAL_ASSIGNMENTS、EXECUTION_QA_CONFLICT、BLOCKING_EXECUTION_FLAG、MANUAL_MATCH_SOURCE_CHANGED。
9. **人工映射**：独立 Research Store V1，sequence＋append-only manualDecisions，每条包含 decision id、action MANUAL_CONFIRMED/MANUAL_REJECTED、opportunityId、logicalTradeId、canonical executionFingerprint、recordedAt。applyManualMatch/Reject 返回新对象；相同事实 reimport 复用，关键 ID/价格/数量/四个时间/逐 Fill facts/flags 变化失效、要求再确认；新确认显式替代该卡片旧确认。冲突确认不越过一对一或硬过滤。未接 Task Card persistence/UI。
10. **Orders QA**：通过 Order ID 获取 entry/exit order IDs 和原 order types，核对全部窗口 Fills 的账户同口径 label、合约/品种/方向、成交总量/VWAP。订单版本不重复累计；完整一致版本可验证总量。reportedStopPrice 从不当 Initial Stop。
11. **History QA**：通过 Buy/Sell Fill ID、Pair ID 核对身份、pair price、pairedQty 和每 Fill 总分配。重复 pair、跨交易 pair、过量或价格冲突→CONFLICT；缺 ID、fill、覆盖或价格→INSUFFICIENT_DATA。同 Position ID 的两笔交易保持独立。P/L 仅检查价格方向关系，符号异常 WARNING；金额未验证，全部明确 pnlAmountVerified=false。
12. **Research Trade schema**：researchTradeId/opportunityId/logicalTradeId；researchFamily/contextSymbol/executionProduct/executionContract；direction/originalSetup/researchSetupClass/manualEvents/manualSetupTransitions；registeredAt/taskEntryConfirmedAt/taskExitConfirmedAt；actualEntryTime/actualEntryCompletedTime/actualEntryPrice/initialStop；actualExitStartedTime/actualExitTime/actualExitPrice/quantity；matchingStatus/matchingReasons/deltas/executionQa/executionFlags/qualityStatus/qualityReasons。时间为绝对毫秒，价格为原 VWAP。未选中交易的执行字段 null，研究壳 BLOCKED，不冒称正式成交。
13. **Initial Stop QA**：复用 frozen effectiveInitialStop 的完整首次/补记/修正 reducer；missing→INITIAL_STOP_MISSING；LONG stop≥entry、SHORT stop≤entry 或非正有限数→INITIAL_STOP_INVALID，仅研究层 BLOCKED，原 Manual Event 不动。
14. **BOF→PB**：originalSetup 不覆盖；researchSetupClass 沿用 frozen model。完整 BOF_TO_PB_RECORDED/REVERTED 事件进入 manualSetupTransitions，含原 ID、recordedAt/effectiveAt、payload 和撤销引用；所有 manualEvents 原样深拷贝。
15. **Quality**：集中 assessResearchQuality：ambiguous/no match/conflict、来源变化、Stop missing/invalid、blocking flag、QA conflict→BLOCKED；时间/缺 exit、review flag 或辅助 QA 不足/警告→REVIEW_REQUIRED；唯一强匹配＋有效 Stop＋QA PASS＋无其他限制→READY。仅 MULTI flags 在完整 QA 后可 informational；Frozen 的 UNSUPPORTED_SCALE_PATTERN 不降级。
16. **Synthetic tests**：新增46条，全部使用人工账户/日期/价格/IDs。下表列出用户26类主测试；额外20条覆盖阈值端点及配置、Stop修正、missing exit/unknown timezone、算法上限、冲突人工确认、Orders冲突/Stop隔离、Pair重复/价格/数量/跨交易冲突、P/L范围、缺counterpart、指纹来源、非法Record/重复ID、open过滤、QA CLI隐私及Unified输入、exit端点、人工重映射、多个订单版本、三个进程时区、不完整PairID、拒绝最新确认不激活已替代旧确认/排除被拒绝冲突、人工窗口外复核。
17. **真实三表 QA**：只读 Fills.csv 16行、Orders.csv 27行、Position History 10行。显式条件 windowStartAssumption=FLAT_CONFIRMED_FOR_QA；Frozen 重建5 closed/0 open，16/16 Fills保留。Orders PASS 5，History PASS 5（仅关联/数量/价格/P&L方向范围），PNL_AMOUNT_UNVERIFIED 5；一笔 MULTI_ENTRY_ORDER/MULTI_EXIT_ORDER/UNSUPPORTED_SCALE_PATTERN 原样保留，仍不能直接 MATCHED。完整 QA 重复100次相同、源文件前后字节 SHA比较相同。
18. **实际 HTML JSON**：已检查本地可见的候选备份；发现的四份是 Risk Manager-only，未取得真实 Task Card JSON。**真实 Tradovate 三表 QA 已运行，但 HTML↔Tradovate 实际匹配尚缺真实 Task Card JSON。** matching/quality 真实统计为 null；未以 synthetic 结果伪装真实验收。CLI可只读接收可选 V5 workspace、intraday envelope 或 Unified V2，经 frozen validators 后匹配；不迁移或写回。
19. **隐私**：仅提交 synthetic 测试及聚合报告；三个真实 CSV/JSON 未复制进仓库。提交前逐项扫描账户、Fill/Order/Position/Pair/Contract immutable IDs、真实交易日期/价格/P&L和完整源行，未命中。CLI另有测试确认输出不含合成敏感事实，异常仅输出结构化错误字段，不吐原始行。已有未跟踪 .DS_Store 保留，不提交。
20. **验证**：npm test 419/419 PASS，0 fail/skip/cancel（基线373，新增46具名测试，无新增 fixture 文件项）；npm run build PASS；node --check dist/app.bundle.js PASS；git diff --check（含 staged 新文件）PASS。
21. **Bundle**：与 3a9f27e 的 dist/app.bundle.js 字节完全相同，SHA-256=05d031cda7813d526f9f50956a789b0f4ec26c210a55bdf8c41abe2985874059。没有修改 app.js/index.html/Router/Risk/Chime/Pages/build/module list/package/frozen parser/reconstructor/model/统一数据结构。
22. **设计问题与限制**：未发现需要改变冻结结构的架构冲突。已知边界：实际 HTML matching 缺真实 JSON；Flat 前提由调用者确认，工具未证明；P/L 金额缺点值/费用，不能声称全金额对账；小批量 solver 超限转歧义；Task Card 无执行账户字段，多账户相同证据可能歧义；Step2 保守 unsupported flag 阻断多订单交易，即使三表关系通过也需未来另行授权才可改变。以上均显式保留，没有扩大本轮开发。
23. **停止与生产隔离**：一个本地 Step3 commit 后停止；未修改 main、未 merge、未 push、未部署 GitHub Pages；未进入 TradingView 行情、1R、MFE/MAE、Milestones、Policy Replay、#/exit-research UI、Tradovate新增导入 UI 或生产自动匹配。

## 用户要求的26类 Synthetic 验收对照

均在 test/exit-reconciliation.test.js 的 S3 01—S3 26 具名测试中执行。

| 编号 | 验证 |
|---|---|
| 01 | 固定族映射与具体执行合约保留 |
| 02 | 品种族不符排除 |
| 03 | 方向不符排除 |
| 04 | Entry差18秒及Exit差14秒形成唯一强匹配 |
| 05 | Entry差7分钟→REVIEW |
| 06 | Entry超10分钟→NO_MATCH |
| 07 | Exit区分Entry等距离的候选 |
| 08 | 相同证据的两个候选→歧义，不按ID猜 |
| 09 | 全局一对一解决贪心陷阱，输入顺序不影响 |
| 10 | 两张等证据卡片竞争一trade→包含未分配可能的双歧义 |
| 11 | 人工确认JSON round-trip和同事实重新导入复用 |
| 12 | 人工拒绝及追加历史保留 |
| 13 | ID/关键事实变化失效，重新明确确认可恢复 |
| 14 | Stop missing→BLOCKED |
| 15 | LONG invalid Stop，原事件保留 |
| 16 | SHORT invalid Stop及SHORT P/L方向正确关系 |
| 17 | BOF原Setup、转换/撤销/再转换全部保留 |
| 18 | 多Entry订单完整QA，only-multi可 informational |
| 19 | 多Exit订单QA；History不足保持 review |
| 20 | Frozen UNSUPPORTED_SCALE_PATTERN，QA通过也BLOCKED |
| 21 | Orders缺记录不改Fills truth |
| 22 | History缺记录不改交易边界 |
| 23 | 同Position ID可以包含两笔独立trade |
| 24 | 不同明确offset换算为同一绝对时间 |
| 25 | matching/Research完整输出重复100次一致 |
| 26 | 深层冻结输入不被修改，输出数组独立 |

## 本地复核入口

```bash
npm test
npm run build
node --check dist/app.bundle.js
git diff --check
node scripts/qa-exit-reconciliation.mjs --window-start-assumption=FLAT_CONFIRMED_FOR_QA <Fills.csv> <Orders.csv> <Position-History.csv> [V5-or-Unified-V2.json]
```

最后一条仅在本地只读，stdout仅聚合；无第四参数时不会产生实际 HTML matching。规范完整列出 API、目标顺序、所有状态/flags、Manual Store和质量规则。
