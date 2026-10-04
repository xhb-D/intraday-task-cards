# Exit Research V0 / Step 3 业务与技术边界

用户已授权本轮实现与一个本地提交；等待人工验收，不自行标为 FROZEN。
基础 commit：3a9f27e85265867cc37afecd8358462044b9f0e3。
分支：codex/exit-research-v0-step3。只新增纯数据模块、synthetic 测试、只读 QA CLI 和文档。

## 现有结构审计与 Level 1 复用评估

实际读取 model.js、tradovate-csv.js、logical-trade.js、time.js、Step1/2 spec/report 和相关测试。
V5 Record 使用 id（输出映射为 opportunityId），symbol GC/CL/ES、direction long/short、type、registeredAt/enteredAt/endedAt、完整 researchCapture。
Frozen Logical Trade 为账户＋具体合约内 Fills-derived flat-to-flat；direction LONG/SHORT，时间为含 raw/normalized/sortKey/timezone/offsetMinutes 的对象，VWAP 不做显示舍入。
窗口起点必须显式确认 Flat。本轮仍不证明实际初始仓位，不支持 KNOWN_INITIAL_POSITION。

Level 1 独立组件扩展，整体应用架构、生命周期、持久化均不变化：

| 路径 | 覆盖及集成 | License/维护/债务 |
|---|---|---|
| 复用现有 parser、重建、V5 validator 和事件 reducer | 全部作为冻结输入/验证层使用；不再实现 CSV 或净仓位算法 | 项目已有代码；不新增第三方 License/升级面 |
| 新增本地小批量穷举 assignment | 用户规则及所有同等最优解可直接审计；纯 JS，无依赖 | 新代码随仓库维护；复杂度上限显式失败为歧义 |
| 外部 assignment 依赖 | V0 样本无需引入；仍要额外处理所有同等最优解、Manual decisions 与质量语义 | 本轮未引入/安装任何依赖，未复制外部代码 |

这是给定约束下的局部实现选择，不修改 Step2 重建定义。生产 bundle 的 build 列表不含研究模块，禁止虚假 import 接入。

## 输入、映射和时间

`reconcileOpportunities(records, logicalTrades, options)` 接收完整保存的 V5 records；复用 assertState 在临时 workspace 校验每笔 Record，包括原 Manual Event 语义。只在临时副本构造活动卡片，不修改输入。
`buildResearchTrades` 编排同一匹配结果与最小 Research Trade。
`assessExecutionQa(trades, orders, positionHistory, {fills})` 以 normalized rows 为输入。若有完整窗口 fills（包括 open position）应显式提供，避免按部分 trade 错算跨交易订单的总量；省略时使用输入 trades 的 fills。

GC→MGC、ES→MES、CL→MCL。researchFamily、executionProduct、executionContract 分别保存；contextSymbol 取原字段，缺失时保持原 record.symbol，不制造连续合约名称。
HTML 毫秒时间戳与 Fills 明确 offset 时间转换后的 epochMillis 做绝对差。使用原时间 parser 校验 raw 与规范化字段的一致性，再计算 UTC 数值；无 offset 返回 EXECUTION_TIMEZONE_UNCONFIRMED，不猜时区。
Orders/History 的无时区时间不参与主匹配、排序、边界或 epoch 换算。

## 候选与全局一对一

集中配置 DEFAULT_MATCHING_CONFIG：entry strong=120000ms、review=600000ms；exit 同样 strong=120000ms、review=600000ms。
Exit 阈值是本轮明确的可配置 V0 交叉验证选择，未预称为经验最优参数。Entry >10分钟不进普通候选，人工确认可选窗口外的同品种/方向候选但仍 REVIEW；人工不能越过其他硬过滤或 exit conflict。

硬过滤：同品种族、同方向、closed、无 blocking flag、无 QA CONFLICT；registeredAt 不参与 score。
Entry ≤2分钟强；(2,10]分钟 review；Exit ≤2分钟强、(2,10] review、>10分钟 DATA_CONFLICT、缺失 TASK_EXIT_MISSING/review。
无合法候选但窗口内存在阻断/QA/时间冲突时返回 DATA_CONFLICT；普通不符合过滤或 >entry窗口返回 NO_MATCH。

先应用有效人工锁定/拒绝，再建立剩余 bipartite connected components，枚举完整组件所有合法部分分配，含 unassigned。
目标按以下顺序逐项最大化，不合并成不透明 score：

1. 匹配数量；
2. entry 与 exit 同时 strong 的数量；
3. exit strong 的数量；
4. entry strong 的数量；
5. 负的总 entryDeltaMs；
6. 负的总 exitDeltaMs（missing exit 按 reviewExitWindowMs penalty）。

总 delta 用 BigInt 精确累计，仅用于内部目标，不进入 JSON。
对所有同等最优 assignment 收集每张卡片的 trade ID/null。只有每个最优解均固定同一 trade 才选中；存在多个 ID 或 ID/null 则 MATCH_AMBIGUOUS。ID 字典序仅保证遍历/输出可复现，不打破证据相等。
一组件任一侧超过8节点或穷举超过200000步骤，整个组件 MATCH_AMBIGUOUS/ASSIGNMENT_LIMIT_REVIEW_REQUIRED，不采用部分解。

匹配状态与关键 reason：

| 状态 | 规则与 reason |
|---|---|
| MATCHED | 唯一、一对一、Entry/Exit 均 strong、QA PASS、无 review flag；FAMILY_DIRECTION_MATCH/ENTRY_STRONG/EXIT_STRONG/UNIQUE_ONE_TO_ONE 或 MANUAL_CONFIRMED |
| REVIEW_REQUIRED | ENTRY_REVIEW_WINDOW、MANUAL_ENTRY_OUTSIDE_WINDOW、EXIT_REVIEW_WINDOW、TASK_EXIT_MISSING、EXECUTION_QUALITY_FLAG、EXECUTION_QA_REVIEW；来源变化为 MANUAL_MATCH_SOURCE_CHANGED 且无选中 ID |
| MATCH_AMBIGUOUS | EQUAL_GLOBAL_ASSIGNMENTS 或 ASSIGNMENT_LIMIT_REVIEW_REQUIRED |
| NO_MATCH | TASK_ENTRY_MISSING、NO_ELIGIBLE_CANDIDATE、ONE_TO_ONE_UNASSIGNED、MANUAL_REJECTED |
| DATA_CONFLICT | BLOCKING_EXECUTION_FLAG 及具体 flag、EXIT_TIME_CONFLICT、EXECUTION_QA_CONFLICT、EXECUTION_TIMEZONE_UNCONFIRMED、EXECUTION_TIME_INCONSISTENT、EXECUTION_TIMELINE_CONFLICT、TIME_DELTA_OUT_OF_RANGE、INVALID_OPPORTUNITY_RECORD、MANUAL_HARD_FILTER_CONFLICT、MANUAL_ASSIGNMENT_CONFLICT |

未知 execution flag 保守归 review-required；UNSUPPORTED_SCALE_PATTERN/RE_ADD_AFTER_EXIT_STARTED/OPEN_POSITION_AT_FILE_END 为 blocking。
仅 MULTI_ENTRY_ORDER/MULTI_EXIT_ORDER 在两种 QA 均 PASS 时为 informational，否则 review-required。
Frozen Step2 当前会给多订单同时标 UNSUPPORTED_SCALE_PATTERN；本轮不会清除/降级它，即使 QA PASS 仍阻断。仅 MULTI 情形由明确的独立 synthetic 输入验证，不篡改真实重建结果。

## 人工映射 Research Store V1

```text
{schemaVersion:1, sequence, manualDecisions:[{
  id:'manual-match:N', sequence:N,
  action:MANUAL_CONFIRMED|MANUAL_REJECTED,
  opportunityId, logicalTradeId, executionFingerprint, recordedAt
}]}
```

applyManualMatch/applyManualReject 返回新 store，时间由调用者显式给定，无 Date.now/random/localStorage。
按同一 ID pair 保留最新决定；同一 Opportunity 最新明确确认替代其之前的确认，完整追加历史仍保留。拒绝最新确认不会重新激活已被替代的旧确认。拒绝保留其 pair，后续重新确认该 pair 可覆盖拒绝。
两张卡片人工确认同一 trade → 双方 DATA_CONFLICT，保留该 trade 避免自动分配给第三张卡片。
executionFingerprint 是 canonical 关键事实 JSON 字符串，不是密码学认证：包含 immutable identity、账户/具体合约/品种/方向、数量、VWAP、四个绝对时间、entry/exit Fill/Order IDs、execution flags、按 Fill ID 排序的各 fill 成交事实。
忽略 CSV display/rawFields、sourceRowNumber、导入时间。相同事实再导入直接复用；ID 消失/变更或关键事实变化返回 MANUAL_MATCH_SOURCE_CHANGED，不用近邻自动补配，Research BLOCKED，需显式重新确认。
Store 含敏感执行事实，只供调用者独立研究数据保存；本轮无真实 store 导出或提交，Task Card/Unified schema 不变。

## 三表 QA

Orders 按 Order ID 关联 entry/exit；保存 matchedOrderIds、entryOrderIds、exitOrderIds、orderTypes（Market/Limit/Stop 等原类型）。对相同 Order 的全部窗口 fills 核对 contract/product/side、同口径 accountLabel、成交数量与 VWAP；至少一个订单版本的累计成交汇总一致即可，不累计多个版本的 filledQty。
Account internal ID 与显示 Account label 不相互等同；有同口径 label 时比较。任一版本 identity 冲突阻断；缺记录/缺数量均价为不足；存在汇总而无一致版本为冲突。
reportedStopPrice 从不用于 Initial Stop。

Position History 按 BuyFillID/SellFillID/PairID 关联；检查 side/账户/具体合约/品种、pair 价格、正整数 paired quantity、每个 fill 分配总量。
重复 Pair ID、跨 Logical Trade pair、过量分配、价格或身份冲突 → CONFLICT；缺 Pair ID/对侧 fill/数量覆盖/价格/P&L → INSUFFICIENT_DATA。
Position ID 仅为 provenance，可跨多个 trade，绝不作为边界。
价格一致容差复用 Step2 的 8×Number.EPSILON×maxabs 口径，不舍入或改写执行事实。
P/L 仅核对 sellPrice-buyPrice 方向关系；符号异常为 WARNING，可能需费用解释。所有输出 pnlAmountVerified=false/PNL_AMOUNT_UNVERIFIED informational：本轮未配置点值及费用，PASS 不代表美元金额对账通过。

两部分均输出 {status:PASS|WARNING|CONFLICT|INSUFFICIENT_DATA, matched IDs, flags:[{code,severity}]}。优先级 conflict > insufficient > warning > pass；缺少辅助表保持 Fills 原事实。

## Research Trade V0 和质量

```text
researchTradeId, opportunityId, logicalTradeId,
researchFamily, contextSymbol, executionProduct, executionContract,
direction, originalSetup, researchSetupClass,
manualEvents[], manualSetupTransitions[],
registeredAt, taskEntryConfirmedAt, taskExitConfirmedAt,
actualEntryTime, actualEntryCompletedTime, actualEntryPrice, initialStop,
actualExitStartedTime, actualExitTime, actualExitPrice, quantity,
matchingStatus, matchingReasons[], entryDeltaMs, exitDeltaMs,
executionQa, executionFlags[], qualityStatus, qualityReasons[]
```

researchTradeId 为 Opportunity ID 与选中 Logical Trade ID tuple 的稳定编码；未匹配/歧义/冲突输出逻辑 ID 和实际执行字段 null 的 BLOCKED 研究壳，不冒称执行成交。
actual times 均绝对毫秒，entry/exit price 直接取 Frozen VWAP。capture 与 transitions 深拷贝。
Initial Stop 复用 effectiveInitialStop：首次/补记再按修正事件推导；missing/非正数/有限性异常及 LONG stop≥entry、SHORT stop≤entry 均 BLOCKED，原事件不变。
原始 type 保留；researchSetupClass 复用 frozen model，mtf_pb→PB，htf_pb/htf_bof→BOF。manualSetupTransitions 保存全部 BOF_TO_PB_RECORDED/REVERTED（含 ID、recordedAt/effectiveAt、payload 引用），不覆盖 originalSetup。

assessResearchQuality 集中规则：匹配歧义/未匹配/冲突、manual source changed、Stop missing/invalid、blocking execution 或 QA conflict → BLOCKED；时间 review/缺 exit/未知或 multi review flag/辅助 QA warning或不足 → REVIEW_REQUIRED；唯一且强匹配、有效 Stop、QA PASS、无阻断/复核 flag → READY。
不计算1R、MFE/MAE、Milestones、Policy Replay。

## QA 和隔离

qa-exit-reconciliation.mjs 必须显式 --window-start-assumption=FLAT_CONFIRMED_FOR_QA；三 CSV 只读，可以额外提供原 V5 workspace、V5 intraday envelope、Unified V2 JSON（原 validator，拒绝不兼容版本，无静默迁移）。只输出聚合及状态，不输出 private IDs/价格/日期/P&L/raw rows。
无 HTML JSON 时明确输出未完成实际 matching；不得使用合成 JSON 冒充真实成交匹配。重复100次比较全输出，前后 SHA 比较源文件字节，指纹留在内存。
不修改生产 UI、Risk、Chime、Pages/Router、build/module list 或 frozen 输入层，不产生部署。
