# Exit Research Step 4B / Conditioned-on-Entry Policy Replay V1

本轮按用户附件的明确实施授权新增独立 Research 组件。Base：33ca4cf7e886001e6af63e6c14bccd981cc71798。
分支：codex/exit-research-v0-step4b-policy-replay。一个独立本地 commit 后停止，等待人工验收；不自行标记 FROZEN。

## 冻结输入与 Level 1 复用检查

实际审计 Step1 model / Manual Events、Step2 logical-trade、Step3 research-trade/reconciliation/research-common/time、Step1–4A spec/report 和相关 tests。
复用 frozen researchSetupClass、initialRisk/rAtPrice、validateMarketDataBundle、market fingerprints、analyzeHoldingPath、request planner 和 clone/uniqueSorted。
不修改任何冻结文件、不增加依赖、不改变 production module list、Unified、model、UI 或 Pages。

本次为明确规范下的独立 Research 组件扩展，Level 1 Reuse Assessment；外部参考仅用于检查时序与防前视，没有复制代码。

| 候选 | 功能匹配、集成成本与技术债 | License / 维护证据 |
|---|---|---|
| 冻结 Step1–4A 本地模块 | 直接复用字段与公式、bar/detail 校验；成本低；选择执行系列的冻结私有 helper 无 export，因此新增隔离 adapter 保持同样身份规则，并用集成 tests 核对 | 本仓库既有代码；零新依赖；不改变冻结 module API |
| TradingView Strategy / Broker Emulator 文档参考 | 默认确认后下一 tick/下一棒、gap 使用 open；平台的默认 OHLC 路径推定不能用来消除本轮未知 Entry boundary；Bar Magnifier 的低周期思想仅作参考 | 官方平台文档；未取得可直接复用代码的许可，不复制；release/issue 响应 UNKNOWN |
| QuantConnect/LEAN 参考 | Stop 市价触发/不利成交原则可对照；完整 Python/C# 引擎和 brokerage 层不适合零依赖 JS 纯组件，移植成本与债务高 | [官方 License Apache 2.0](https://github.com/QuantConnect/Lean/blob/master/LICENSE)；本轮未核验 release/issue 维护活跃性 |
| Freqtrade lookahead 参考 | 全量数据导致前视、扰动/对比思路可用于 QA；其交易系统不能直接替代本轮限定 Entry Replay | [官方 License GPLv3](https://github.com/freqtrade/freqtrade/blob/develop/LICENSE)；不引入或复制代码；维护活跃性 UNKNOWN |

来源：[TradingView Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/)、[QuantConnect Stop Market](https://www.quantconnect.com/docs/v2/writing-algorithms/trading-and-orders/order-types/stop-market-orders)、[Freqtrade Lookahead](https://www.freqtrade.io/en/stable/lookahead-analysis/)。
只检索官方技术文档，未连接 TradingView 行情/API/MCP、网页账户或 broker。
与规范冲突的默认棒内路径推定不采用；本轮遵循用户冻结时序与 conservative boundary，而非照搬平台回测全部语义。

## API 和 Policy Config

`replayExitPolicy(researchTrade, marketBundle, options)`，options：

```text
policyId: 必需的 versioned ID
policies: 默认 POLICIES_V1，可明确传入独立配置集合
setupStateSource: MANUAL_ACTUAL（默认）|FIXED_INITIAL_SETUP|RESEARCH_TRANSITION_RULE
replayHardEndAt: 必需、安全整数 epoch ms，严格 > actualEntryTime
executionTickSize: 可信执行 tick；默认 null，不从 Bundle/proxy/display 猜测
primarySeriesId: 可显式选择；默认 exact→same-expiry proxy→continuous
detailSeriesId: 默认自动匹配；null 关闭 detail
hardEndMark: null 或 {at,price,seriesId,source}，必须标识选定 primary 与精确 Hard End
```

所有新增模块均纯函数，无 DOM、localStorage、网络、Date.now、random。新对象输出，原始 ResearchTrade/Bundle/Policy/Event 不变。
Policy schema 精确字段：

```text
policyId, policyVersion:1, setupClass:PB|BOF, pairedPolicyId,
classification:EXPERIMENTAL_BASELINE,
stages:[{name,activateAtMfeR,givebackPct,minimumLockR,forceExit,ceilingMode}],
allowProtectionLoosening:false,
activationTiming:NEXT_BAR_AFTER_CONFIRMATION,
executionModelVersion:OHLC_STOP_NEXT_BAR_V1
```

stage 的 activateAtMfeR 严格递增，首项0；name唯一。没有重叠范围字段，区间由相邻 activation 唯一划分。
givebackPct 为 null 或 (0,1) 的比例，minimumLockR 默认 null；启用时有限、非负且不高于该 stage activation。
INITIAL 必须没有动态保护/forced exit；forceExit 与 HARD 一致，ceiling 只能位于末项。
未知字段、非法版本、loosen、timing、giveback、overlap、坏配对均失败闭合。
每组 PB/BOF pairedPolicyId 互相对应；初始 policy 的 setup 必须与 frozen originalSetup/researchSetupClass 一致。结果保存完整 policyDefinitions，避免 ID 单独掩盖参数差异。

| Setup | activation | stages | giveback |
|---|---|---|---|
|PB|0/2/6/8/10|INITIAL/RUNNER/PROTECT/EXTREME/SOFT_CEILING|null/null/.30/.25/.20|
|BOF|0/2/4/6/8|INITIAL/RUNNER/TARGET_REVIEW/EXTREME/SOFT_CEILING|null/null/.30/.25/.20|

六个只读、versioned configs：PB/BOF_BASELINE_V1、PB/BOF_TIGHT_GIVEBACK_V1、PB/BOF_HARD_CEILING_V1。
Tight 保持 activation，giveback .25/.20/.15；Hard 将末项改为 HARD_CEILING/forceExit。
它们全部为 EXPERIMENTAL_BASELINE，未经真实行情或交易验证，不是最终规则或交易建议。
2R 不自动 BE；RUNNER 继续 Initial Stop。

## 独立窗口、路径与覆盖

Actual Metrics 仍是 actualEntry→actualExit，原 planner 不变。
`planReplayMarketDataRequests(trade,{replayHardEndAt})` 输出 purpose=POLICY_REPLAY、5M EXECUTION_PRIMARY、实际 Entry→Hard End、includeOverlappingBars、providerSymbol=null；不擅自解析 TV symbol。
临时 request/path adapter 只替换局部 end 字段，不修改 ResearchTrade，也不将该窗口当 Actual Holding Truth。
Engine 完全不以实际 Exit/ExitPrice 终止或标价。数据需连续覆盖 Entry→模拟 Exit，未退出则需到 Hard End。
Request 一律预先请求到 Hard End；执行中若先合法退出，之后的 missing bars/gap 不阻断；仍存活时 leading gap、intermediate gap、tail 缺失阻断，不填棒。
整体 Bundle schema 和内部数据矛盾仍在运行前校验；不因为早退出而掩盖 malformed/fake metadata。
复用 Step4A identity/priority、detail 同 market、integer subdivision 和完整 primary OHLC 聚合一致性；没有 context 参与执行。

## 5M 事件顺序与 policyKnownMfe

每 primary 5M bar：[openTime,closeTime)，从 Actual Entry 开始，以 Hard End 限制。

1. 应用上一个完成棒确认的 pending policy/stage/protection。
2. 用已生效保护检查当前 open 的 gap stop。
3. 若有上一棒确认的 Hard Ceiling market exit，且 gap stop 尚未退出，按当前 open 退出。
4. 按时间检查该棒已有保护的普通 Stop；如退出，不读该棒后续 extreme 来确认 MFE/stage。
5. 仍存活且5M已完成时，仅从 Entry 之后完全可确认的 bars/detail 更新 policyKnownMfe。
6. 一起确认2/4/6/8/10R milestones、处理届时已记录且到期的人工状态、查配置 stage、计算 next protection。
7. pending 从下一根 primary 5M 生效。即使 detail=1M，也不提前计算 Policy。
8. 到 Hard End 则按下述模型退出，不让 Actual Exit 提前终止。

policyKnownMfe 从0R起，是截至当时已确认、存活的完成棒 favorable R 最大值；不读 possibleMaxR、最终 Research MFE、未来棒、真实 Exit price。
Stop 触发棒中的已存活 detail 即使已见更高 high，Policy 仍不更新，因为确认时点固定5M且已退出。
Entry 在5M内时，只用 frozen path 中 fullyContained 的 post-entry detail；尚不确定部分完全不用于 stage activation。
若该 entry 部分 adverse extreme 可能触及现有 Stop，则 ENTRY_STOP_BOUNDARY_AMBIGUOUS/BLOCKED；否则 trace ENTRY_BOUNDARY_IGNORED_FOR_POLICY_ACTIVATION，并 REVIEW_REQUIRED。
即使1M仍跨 Entry 秒点也如此，不制造 print timing。

## 保护、Tick 和 fill

复用 frozen 1R=abs(actualEntryPrice-initialStop)，方向正确且有限>0；Entry=0R、InitialStop=-1R。
ProtectionR=max(previous theoretical active R, knownMfeR*(1-givebackPct), minimumLockR if enabled)。
无 giveback/minimumLock 时保持 previous protection，不放宽。
价格 LONG Entry+ProtectionR*risk；SHORT Entry-ProtectionR*risk。
可信 executionTickSize：LONG floor、SHORT ceil 到 execution grid；仅在极小浮点表示误差内吸附网格，不以 display/proxy tick 替代。
初始 Stop 若不在明确 execution tick grid，BLOCKED/INITIAL_STOP_OFF_EXECUTION_TICK，不偷偷修正 frozen Stop。
finalActiveProtectionR 是理论 active R；finalRoundedProtectionR 和 finalActiveProtectionPrice 是实际执行网格的值；两者明确区分。
没有 tick 时理论价格可模拟，但 TICK_ROUNDING_UNAVAILABLE/REVIEW_REQUIRED。不扣 slippage：NONE_V1。
LONG open<=Stop：gap fill=open；否则 low<=Stop：fill=Stop。SHORT 对称。
5M/detail 内正常 Stop 的准确秒不可知：simulatedExitTime=null，simulatedExitTimeRange 保留触发棒区间。Trace.at 是该证据可报告的 close，不冒充 fill 秒点。
gap、next-open ceiling 和 Hard End 是模型 open/close/explicit mark 时点，标签 MODEL_BAR_OPEN / MODEL_BAR_CLOSE / EXPLICIT_MARK；这些仍是模拟，不是真实 broker Fill。

## Manual Setup Switching

Entry Setup 固定 frozen originalSetup 分类。MANUAL_ACTUAL 按原 manualEvents 顺序读取记录/撤销，并核对 manualSetupTransitions（若存在）。
不得删除撤销对应的历史 recorded event，也不把最后状态 retroactively 写回过去。
以 recordedAt 作为因果可用时点；effectiveAt 必须与该转换记录相同；每个转换映射到其所在 primary 5M 的下一 open。
例如10:47:20→10:50；恰好10:50:00属于新棒→10:55。5M grid 以明确 primary epoch anchor 为准，不用所在地时区。
Trace 保留 manualTransitionAt、policyTransitionEffectiveAt、eventId、setupStateSource；事件在其所在5M完成时报告，不提前泄露。
若转换已在 Entry 前记录并且 policy effective 已到，则在 Entry 生效。
转换/撤销只改变 policy mapping，保留原1R、累计MFE、已锁保护；新 stage 按继承 MFE 查对应 PB/BOF。
FIXED_INITIAL_SETUP 不影响 policy，但 trace 仍保留人工事实并标 ignoredForPolicy=true。
RESEARCH_TRANSITION_RULE 仅枚举预留，本轮明确 RESEARCH_TRANSITION_RULE_NOT_CONFIGURED/BLOCKED；没有自动转换规则。

## Ceiling / Hard End

Soft Ceiling 只加强 giveback，不 forced exit。
Hard Ceiling 在已完成5M确认达到PB10/BOF8R后，下一棒 open 用 market 模型退出，不能 same-bar threshold fill。
若该 open 已穿旧保护，existing gap stop 先执行；否则 ceiling market exit 先于该棒稍后的 ordinary stop。此优先级固定且测试覆盖。
预先给定 Hard End：>Actual Entry；没有 GC/ES/CL 的隐式收盘时点。
正好完成5M close：最后完整bar.close；落在棒内时，允许完整一致 detail 正好结束于 Hard End 的 close，或独立 identified explicit mark。
若无法确认 mark：HARD_END_BOUNDARY_AMBIGUOUS/BLOCKED，不用未来整棒 close。
若最后不完整片段可能触及 Stop：HARD_END_STOP_BOUNDARY_AMBIGUOUS/BLOCKED；单个 explicit mark 不足以证明此前未触发。
mark 与已完成 close 不一致、低于/高于未触发 Stop 等矛盾也失败闭合。Hard End 恰好确认 ceiling 时没有后续 holding bar，以 REPLAY_HARD_END 结束。

## Trace / QA / Result

Trace 每项：sequence/type/at/causeSequence＋当时已知 payload。仅追加，无随机时间/ID；effect 指向已有 confirmation/calculation/manual cause。
BAR_STARTED 只含当前 prior-state，不含当前 high/low；MFE/milestone/stage确认带已完成5M区间；保护 calculation 和下棒 effect 分开。
不在早期 trace 中写最终MFE、最终Exit、未来milestone或possible extreme。
Replay Result V1：

```text
schemaVersion:1, researchTradeId, policyId, policyVersion,
replayEngineVersion:CONDITIONED_ENTRY_5M_V1,
executionModelVersion:OHLC_STOP_NEXT_BAR_V1, slippageModelVersion:NONE_V1,
setupStateSource, priceSourceMode, policyDefinitions, marketDataFingerprint, bundleFingerprint, provenance,
replayStartAt, replayHardEndAt, initialRiskPoints, executionTickSize, hardEndMark,
simulatedExitTime, simulatedExitTimeRange, simulatedExitPrice, simulatedExitR, exitReason,
maxKnownMfeR, finalActiveProtectionR, finalActiveProtectionPrice, finalRoundedProtectionR,
finalPolicyId, finalStage,
lookaheadQaStatus:PASS|FAIL, lookaheadQaReasons[],
qualityStatus:READY|REVIEW_REQUIRED|BLOCKED, qualityReasons[], statisticsEligible,
trace[], auditBars[]
```

auditBars 是完整运行后的因果 ledger，与早期 trace 区分：bar prior state、实际检查过的 executionSegments、确认 evidence、knownMfeBefore/After、next state、exited。
`auditReplayLookahead(result,trade,bundle?)` 独立校验 chronology、初始和 prior protection、source evidence、confirmed membership、5M next state、stage/config数学、manual raw timing、trace cause/禁future字段、退出执行原因与价格/区间。
Engine 总是传 Bundle 以核对原始行情；只传两个参数时 QA 不执行原始行情交叉验证，应在人工审计时传 bundle。
这是带证据的有限 QA，不是任何未来代码修改都无前视的形式证明。测试同时有 deliberately wrong fixtures、未来扰动和独立有序 path oracle。

集中 `assessReplayQuality`：前序BLOCKED/未知、invalid risk/config/time/data、未覆盖存活路径、无法执行Hard End/边界Stop、QA非PASS→BLOCKED。
前序REVIEW、proxy（continuous双flag）、无execution tick、entry boundary忽略/partial mark→REVIEW_REQUIRED。
原READY＋exact＋已执行路径complete＋QA PASS＋无问题→READY，statisticsEligible=true。proxy不与exact无区别统计。
验证阻断 run 的 QA 状态FAIL/RUN_NOT_EXECUTED表示未完成可认证执行，不能视作成功；block 结果 simulated exit字段清空，trace保留失败原因。

## Verification / 限制

全部仓库测试 synthetic；无真实行情 Replay、无实盘/broker验收。
检查 npm test、npm run build、node --check dist/app.bundle.js、git diff --check；bundle 必须与冻结 Step4A 逐字节一致。
没有交易日历解释gap、slippage、spread/手续费、partial fills、scale in/out、自动Entry/setup、portfolio、网络、UI、持久化或正式统计整合。
OHLC来源与tick可信度需要外部数据生产者确认；canonical identity不是真实性签名，完整运行 ledger/identity占用内存，V0非流式。
不需改变 Step1–4A frozen结构；完成后停止，不进入UI/Step5/上线。
