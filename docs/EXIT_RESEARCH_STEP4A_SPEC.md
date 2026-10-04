# Exit Research Step 4A / Market Metrics V1 规范

本轮按用户附件明确授权实现；基线 037841a3c2c17dc4eed3ba4e23dc0d07bf5da797。
只新增独立 Research Derived Data；完成一个本地 commit 后停止等待人工验收，不自行标记 FROZEN。
分支 codex/exit-research-v0-step4a-market-metrics，独立干净 worktree；旧 Step3 worktree 的未提交文档原样保留。

## Frozen 输入审计与 Level 1 复用评估

实际读取 model.js、research-trade.js、reconciliation.js、research-common.js、time.js、Step1/2/3 spec/report 与相关测试。
Step1 V5 Manual Event reducer 保留原始 stop/setup 与校正/撤销事件；Unified V2 不变。
Step2 Logical Trade 仍只从显式起点 Flat 的 Fills 重建，明确 offset 的时间和实际合约为输入事实，不改其算法。
Step3 actualEntryTime/actualExitTime 为绝对毫秒，actual prices 为 VWAP；qualityStatus/reasons 已集中定义，contextSymbol 缺失为 null。
冻结 Step3 代码已修正 contextSymbol；其旧 spec 的 record.symbol fallback 文字尚未随修复 commit 提交。以本轮明确指令和冻结代码为准，不修改旧规范/输入结构。

Level 1：对既有独立 Research 层添加纯计算模块，不改变生产架构、生命周期、业务 Truth 或任何持久化。

| 路径 | 功能匹配/集成 | License、维护与债务 |
|---|---|---|
| 复用现有 research-common 的 clone/samePrice/uniqueSorted 及 symbol-map | 共享浮点表示口径、身份分类；无重复 CSV/交易重建 | 现有已冻结仓库代码；零新依赖，集成成本低 |
| TA-Lib MAX/MIN/MAXINDEX/MININDEX 参考 | 覆盖普通序列极值；未直接覆盖本轮 closed holding window、possible bounds、代理/quality/人工 facts | 官方三条件 BSD License；本轮未核验 release/issue 响应，维护活跃程度 UNKNOWN；不引入 C/语言 wrapper，不复制源码 |
| 本地有限线性扫描组件 | 用户定义的确认/可能集合、gap/detail/proxy/milestone 可直接审计 | 自维护严格 schema 与边界测试；无 package/build/生产集成改动；大文件非流式为已知债务 |

参考：[TA-Lib 官方 functions](https://ta-lib.org/functions/) 与 [官方 License](https://github.com/TA-Lib/ta-lib/blob/main/LICENSE)。
外部资料仅用于能力边界评估，本轮没有外部代码复用、安装、API/MCP 或行情请求。

## API 与市场身份

纯模块：market-config、market-request、market-data、r-math、path-metrics、milestones、market-metrics。
没有 DOM/localStorage/网络/Date.now/random；只计算新对象，输入数组不排序、不修改。

`resolveContextMarket(researchTrade, defaults=DEFAULT_CONTEXT_MARKET_V1)`：显式非空 contextSymbol 优先，source=TASK_CARD_EXPLICIT；缺失/null 使用独立研究配置 GC→GC1!、ES→ES1!、CL→CL1!，source=DEFAULT_RESEARCH_CONFIG；未知族 UNRESOLVED。
输出 resolvedContextSymbol/contextSymbolSource，绝不写回 ResearchTrade.contextSymbol。
三种身份始终分离：researchFamily GC/ES/CL、context 用户看图市场、execution 微型具体合约。

## Market Request Plan V1

`planMarketDataRequests(trade, {contextDefaults}={})` 返回：

```text
schemaVersion:1, researchTradeId, status:PLANNED|BLOCKED,
qualityReasons[], detailMode:ON_DEMAND,
requests:[
  {role:EXECUTION_PRIMARY, researchFamily, desiredProduct, desiredContract,
   providerSymbol:null, priceSourcePriority:[EXACT_EXECUTION_CONTRACT,
      SAME_EXPIRY_LARGE_CONTRACT_PROXY, CONTINUOUS_CONTRACT_PROXY],
   timeframeMs:300000, requiredStartAt, requiredEndAt,
   includeOverlappingBars:true, timestampSemantics:BAR_OPEN_TIME},
  {role:CONTEXT, researchFamily, resolvedContextSymbol, contextSymbolSource,
   providerSymbol:null, timeframeMs:1800000, requiredStartAt, requiredEndAt,
   includeOverlappingBars:true, timestampSemantics:BAR_OPEN_TIME}
]
```

requested window 为真实 holding window；外部 producer 必须包括与之相交的边界棒，不能仅按 bar open 落在窗口内过滤。
providerSymbol 一律留 null，等待数据生产者明确解析；不会从 MGCZ9 自行拼出 TradingView symbol，context 缺省字符串也不擅自加 exchange prefix。
Step3 BLOCKED 不升级；无实际 execution window 的 Research 壳返回 BLOCKED/空 requests。
Context 30M 仅计划/schema，不进入 execution MFE/MAE。Detail ON_DEMAND，实际 bundle 可补需要细化的棒，不拉网、不发请求。

## Market Data Bundle V1

独立 JSON artifact，不进入 Unified/TaskCard/localStorage：

```text
{schemaVersion:1, source:string, sourceVersion:string, createdAt:epochMs,
 series:[MarketSeries]}

MarketSeries {
 seriesId, role:EXECUTION_PRIMARY|EXECUTION_DETAIL|CONTEXT,
 provider, providerSymbol, researchFamily, product, contract,
 priceSourceMode, timeframeMs, timestampSemantics:BAR_OPEN_TIME,
 timezone:UTC|EXPLICIT_ABSOLUTE_TIME,
 coverageStart, coverageEnd, bars[],
 [proxyForContract], [tickSize]
}

Bar {openTime:epochMs, open, high, low, close, volume:number|null}
```

全部必需字段精确 key 校验，拒绝未知字段/不兼容 schema。字符串非空；时间为非负安全整数绝对毫秒，不解析本地日期文本。
CONTEXT 使用 priceSourceMode=CONTEXT_MARKET，执行系列使用三个枚举之一。
priceSourceMode=EXACT_EXECUTION_CONTRACT 必须 product/contract 与 Research 执行事实完全相同。
同到期大合约代理必须 product=researchFamily、proxyForContract=真实微型合约，显式 contract 的月码/年后缀与 execution 合约一致（不把年后缀当独立到期年份证明）。
主连代理同样要求显式 product/contract/providerSymbol 与 proxyForContract；来源由 producer 明确声明，不自动猜 provider identity 或换月规则。
自动选取按 exact→same-expiry→continuous；同优先级多个系列返回 EXECUTION_SERIES_AMBIGUOUS，可通过 primarySeriesId 明确选择。Context 永不候补执行路径。

## Validation、gap 与 coverage

`validateMarketDataBundle(bundle)` 返回 valid、qualityStatus:VALIDATED|BLOCKED、qualityReasons、issues[{code,path}]、每 series 的实际coverage/gaps/flags。
OHLC 必须有限正数，high≥open/close/low，low≤open/close；volume 为 null 或有限非负值。
bars 必须严格递增；重复、倒序、时间间隔短于 timeframe 的重叠均拒绝，绝不排序、去重、修正或填棒。
非空 series 的 coverageStart 必须等于首 bar open；coverageEnd 等于末 bar open+timeframe，防止元数据冒充完整覆盖。空 series 可保留声明范围，但 actualCoverage=null/MARKET_SERIES_EMPTY，Metrics 不认为它有数据。
seriesId 不重复；providerSymbol 必须由 producer 解析后给出，Request 的 null 不能当成有效 Bundle symbol。
相邻间隔大于 timeframe 只记录 MARKET_DATA_GAP 区间，不把市场休市直接视为格式错误。
holding 窗口跨未覆盖区间 → INCOMPLETE/MARKET_DATA_INCOMPLETE；若是已知相邻棒之间的 gap，另记录 MARKET_DATA_GAP。窗口外 gap 不降级当前 metrics。
V0 未引入交易日历，也不声称已判明休市与漏数据；跨 gap 保守视为 incomplete，绝不生成 bars。

## Identity 与 provenance

`marketSeriesFingerprint` 是固定字段顺序的 canonical content string（market-series-v1: 前缀），包含 provider/symbol、family/product/contract/mode/proxy关联、tick metadata、timeframe/time semantics/timezone/coverage、全部数值 bars。
`marketBundleFingerprint` 对 series canonical strings 排序，忽略系列排列顺序、外部 seriesId、createdAt、source/sourceVersion；这些来源信息仍单独保留在 provenance。
同样 bars 与 instrument metadata 得到同 identity。价格/volume/时间/品种/契约/provider 改动会改变 identity；不是密码学签名或真实性证明，也不是 SHA-256 摘要。canonical string 与 bars 同规模，V0 非流式、小批量，避免新增 runtime dependency。
Metrics provenance 保留 bundle source/sourceVersion/createdAt、primary 与 detail 的各自 seriesId/provider/providerSymbol/product/contract/mode/timeframe/coverage/fingerprint/detailUsed。

## Initial Risk / R

`initialRisk(trade,{tickSize:null})`：abs(actualEntryPrice-initialStop)，有限且>0；LONG stop<entry，SHORT stop>entry，否则 INITIAL_STOP_INVALID；缺 stop INITIAL_STOP_MISSING。
`rAtPrice`：LONG (price-entry)/risk；SHORT (entry-price)/risk。Entry=0R、InitialStop=-1R；不覆盖原始 Stop。
initialRiskTicks 默认 null。只有调用者显式给出可信 executionTickSize，才除以它；不从 display precision 或代理大合约 tick 猜执行 tick，不做 tick rounding。
除法、累计价格/R/threshold 溢出返回 R_NUMERIC_OVERFLOW/BLOCKED，不把 null/Infinity 变成0R。

## Holding path、detail 与极值

主系列固定 EXECUTION_PRIMARY 5M（300000ms）。bar=[openTime,openTime+timeframeMs)，holding=[actualEntryTime,actualExitTime]。
bar 完全包含于 holding 才可将 high/low 进入 confirmed；相交 entry/exit boundary 的 high/low 只进入 possible。同一 bar 内完成交易仍按此规则。
actualEntryPrice/actualExitPrice 是独立已知成交观测，始终可进入 confirmed。边界 bar 的 open/close 没有实际打印时刻，不能新增伪确定事件。
exit 正好 bar close 包含此前完整棒；下一棒 openTime=exit 的 high/low 不进入持仓路径。零时长使用已知端点及该瞬间覆盖检查，无虚构时间区间。

Detail 可指定 detailSeriesId 或在同 execution market/proxy 自动选唯一 detail；错误市场、同级多系列、非更小整数细分 timeframe 失败闭合。
需同 provider/providerSymbol/family/product/contract/mode/proxyForContract。不能把 MGC 5M 与 GC1! 1M 混用。
只有 detail 完整连续铺满一个相关 primary bar，并与 primary 汇总 OHLC 在 frozen samePrice 容差内一致，才替换该棒；差异 DETAIL_AGGREGATION_CONFLICT/BLOCKED。
部分 detail 不足以认证完整边界，退回较宽 primary possible bounds，DETAIL_COVERAGE_INCOMPLETE/review。无需细化的完整 primary bar 不因缺 detail 降级。
完全 minute-aligned holding 可由完整1M棒解决5M边界；成交秒点仍落在1M内时保留 INTRABAR_BOUNDARY_AMBIGUOUS，绝不声称 tick-level exact。
完整 detail 也可缩窄已触及 milestone 的时间棒，不改变 primary/Policy 规则；本轮没有 Policy。

MFE=max(0,最大 favorable R)；MAE=max(0,-最小 R)，另保留 mae.worstR。
confirmed 集合=Entry/Exit价格＋完全位于 holding 的选定棒极值；possible 集合再加入未解析 boundary 极值。
每项输出 exact、partial、confirmedR、possibleMaxR、confirmedPrice、possibleExtremePrice、qualityFlags。
exact 表示完整 coverage 下该指标上下界相同（OHLC级别），不是 tick级别数据声明。
coverage 不足时 partial=true、exact=false，保留 confirmed lower bound；possibleMaxR/possibleExtremePrice=null，缺数据没有全局有限上界，不输出伪完整值。
代理结果仍以实际 entry/stop 的点数 R 坐标表示，标 metricQuality=PROXY；不做基差、乘数、连续调整或隐藏价格换算。

## Milestones

固定2/4/6/8/10R，LONG entry+N×risk、SHORT entry-N×risk；短向 threshold 可非正，正价数据不会触及它，不人为改变公式。
状态 CONFIRMED_REACHED/POSSIBLE_BOUNDARY_REACHED/NOT_REACHED/DATA_INCOMPLETE。
完整棒极值或独立实际 Exit price 可确认到达；仅不明 boundary 触及为 possible。缺数据且无确认触及为 DATA_INCOMPLETE，不能断言 never reached。
输出首次可能棒 firstReachedBarOpen/Close、firstReachConfirmed、firstConfirmedBarOpen/Close、firstReachedSeriesId、confirmedObservationAt。
confirmedObservationAt 仅为已知实际 Exit 观测时刻，不是新推导的首次触及时刻。
早期 boundary possible、后来完整棒 confirmed 时：整体 reached 确认，但首次时间仍不确定，FIRST_REACH_TIME_UNCERTAIN，不用后来时间覆盖更早可能事件。
一个棒内多个 milestone 可以共享5M/1M区间，不伪造秒级顺序、不执行任何行为。

## Result 与集中质量

`calculateMarketMetrics(trade,bundle,{primarySeriesId:null,detailSeriesId:undefined,executionTickSize:null})`。
显式 detailSeriesId=null 关闭 detail；默认 ON_DEMAND 自动选唯一同市场系列，无网络。

```text
schemaVersion:1, researchTradeId, marketSeriesId, priceSourceMode,
marketDataFingerprint, bundleFingerprint, provenance,
initialRiskPoints, initialRiskTicks, holdingWindow,
mfe, mae, milestones,
coverageStatus, coverageGaps, detailModeUsed:NONE|ON_DEMAND,
metricQuality:EXACT|PROXY, statisticsEligible,
qualityStatus:READY|REVIEW_REQUIRED|BLOCKED, qualityReasons[]
```

marketMetricsQuality 集中定义：
- 原 Step3 BLOCKED、缺/非法stop、无路径、数据格式/身份/时间/detail矛盾、coverage不足、数值溢出 → BLOCKED。
- Step3 REVIEW、proxy（PRICE_SOURCE_PROXY；continuous另CONTINUOUS_CONTRACT_PROXY）、boundary/detail不足 → REVIEW_REQUIRED。
- Step3 READY＋exact执行合约＋完整coverage＋无以上问题 → READY。
Step3 quality/reasons 只沿用、不重判，不通过行情升级前序质量。
只有本结果 READY 且 exact execution source，statisticsEligible=true；代理与不完整结果默认 false。

## 本地 QA 与 Verification

qa-market-metrics.mjs 接收单笔 Research Trade JSON 和 Bundle JSON，只读、重复100次完整输出比较及源字节比较。
stdout 仅 family/direction/source mode/coverage、MFE/MAE R bounds/status、milestone states/quality；不输出账户/Fill/Order IDs、原始bars、providerSymbol、canonical content 或交易日期价格。
全部仓库行情/交易测试均 synthetic；尚无真实 TradingView Bundle，不能声称真实行情验证。
测试对照与本轮完整检查见 STEP4A_REPORT。生产bundle必须与 037841a3 字节相同；Step1–3/frozen tests/Unified/UI/Pages/build/dependencies 一律不改。
不开发 Policy、Giveback、动态Stop、Replay Trace/Hard End/PostExit、TradingViewAPI/MCP连接、VPS/Webhook/Cloudflare 或研究UI。
