# Exit Research Step 4A — 中文完成与验证报告

完成已授权的独立 Market Metrics V1 实现；一个本地 commit 后停止，等待人工验收，不自行 FROZEN。

1. **分支**：codex/exit-research-v0-step4a-market-metrics。
2. **Base**：037841a3c2c17dc4eed3ba4e23dc0d07bf5da797。新 managed worktree 从该 commit 创建，初始 tracked clean；旧 Step3 文档修订未复制/覆盖。
3. **Step4A commit SHA**：最终交付消息给出完整 SHA，亦可通过该分支 git rev-parse HEAD 核对，避免 commit 文件的自引用。
4. **文件**：仅新增11个文件：src/exit-research/{market-config,market-request,market-data,r-math,path-metrics,milestones,market-metrics}.js、scripts/qa-market-metrics.mjs、test/market-metrics.test.js、docs/EXIT_RESEARCH_STEP4A_SPEC.md、本报告。旧文件没有改动。
5. **Request Plan**：V1 researchTradeId/status/reasons/detailMode＋两个 requests：EXECUTION_PRIMARY 5M、CONTEXT 30M，明确实际holding开始/结束和 includeOverlappingBars；desired execution product/contract保留，providerSymbol=null，留给外部 producer 明确解析。
6. **Context 配置**：独立 DEFAULT_CONTEXT_MARKET_V1 GC→GC1!/ES→ES1!/CL→CL1!；输出 resolvedContextSymbol/contextSymbolSource。显式值 TASK_CARD_EXPLICIT 优先，缺失为 DEFAULT_RESEARCH_CONFIG；不写回 Step3 的 contextSymbol=null。
7. **Execution modes**：exact具体执行合约优先，再same-expiry大合约，再continuous代理。代理需显式 proxyForContract 与 provider identity；same-expiry后缀校验，不制造 provider symbol。代理标 PRICE_SOURCE_PROXY，continuous再标 CONTINUOUS_CONTRACT_PROXY，metricQuality=PROXY、statisticsEligible=false。
8. **Bundle V1**：严格独立 JSON，source/sourceVersion/createdAt/series；每系列identity、role/provider/symbol/family/product/contract/mode/timeframe/time语义/timezone/coverage/bars，可选proxy关联与tick metadata。没有Unified/localStorage schema变更。
9. **Bar validation**：正有限OHLC、high/low关系、非负有限或null volume、安全整数epoch、严格递增、无重复/重叠、coverage元数据一致、精确字段/版本。结构化 code/path，不排序/去重/修价/填棒。
10. **Gap/coverage**：相邻间隔大于timeframe记录gap，不直接当格式错误；窗口跨gap→INCOMPLETE/BLOCKED，窗口外gap可保持COMPLETE。没有交易日历解释或休市补棒。partial confirmed值保留，无全局完整possible上界；Actual Exit仍用原事实。
11. **Content identity**：canonical instrument metadata＋全bars，固定字段顺序；Bundle按content排序。createdAt与外部seriesId不改变identity；两系列各自保留fingerprint和来源。不是SHA/认证；无新runtime依赖，完整canonical字符串有内存成本。
12. **1R**：abs(actualEntryPrice-initialStop)>0且有限；LONG stop<entry，SHORT stop>entry。Entry=0R、Stop=-1R。initialRiskTicks默认null；只有显式可信executionTickSize才计算，不猜精度、不round、不改stop。
13. **MFE**：LONG high、SHORT low对统一R坐标取最大正幅度。已知Entry/Exit及完整holding棒进入confirmed；边界极值只进入possible。输出确定下界/可能上界及exact/partial，不把Entry整根5M极值当真。
14. **MAE**：LONG low、SHORT high，输出正幅度及内部worstR负值，确认/可能集合与MFE相同。覆盖不足的possibleMaxR=null，不制造完整亏损路径精度。
15. **Boundary**：bar=[open,close)、holding=[entry,exit]。处理Entry/Exit overlap、same-bar、entry在open、exit在close。边界open/close无print时刻也不确认极值；不把出场后的下一棒high/low收入holding。
16. **1M detail**：ON_DEMAND；同provider/symbol/product/contract/proxy、较小整数分割周期；需要完整铺满相关5M并通过汇总OHLC一致性。部分缺detail退回primary宽界；wrong contract或aggregate矛盾阻断。成交秒点仍落在1M内继续INTRABAR_BOUNDARY_AMBIGUOUS，不称tick exact。
17. **Milestones**：2/4/6/8/10R，按方向生成threshold；CONFIRMED_REACHED/POSSIBLE_BOUNDARY_REACHED/NOT_REACHED/DATA_INCOMPLETE。首次保留5M或1M棒区间，不造秒级时间或同棒内事件顺序；更早possible与后来confirmed分开。Exit已知观测时刻不是推导的首次触及。
18. **Result schema**：V1 trade/series IDs、source mode、series/bundle fingerprints、完整来源provenance、initialRiskPoints/Ticks、holdingWindow、mfe/mae/milestones、coverage/gaps/detailMode、metricQuality/statisticsEligible/quality/reasons。只为Research Derived Data，不写TaskCard。
19. **Quality**：集中marketMetricsQuality。Step3 BLOCKED保持BLOCKED；Step3 REVIEW只维持或降低。非法risk/no path/数据冲突或coverage不足BLOCKED；proxy/boundary/detail不足REVIEW_REQUIRED；前序READY＋exact完整无问题才READY。代理默认不能混入exact正式统计。
20. **Tests**：新增62具名synthetic测试，下表给出全部40类要求对照；额外覆盖partial detail、outside-window gap、关联冲突、来源优先级/歧义、首触不确定、数值溢出、scope纯模块、CLI隐私与只读、跨三host时区、Step1–3集成，以及独立逐秒LONG/SHORT oracle。没有新fixture文件项。
21. **全部检查**：基线420/420；最终npm test 482/482 PASS，0失败/skip/cancel；npm run build PASS；node --check dist/app.bundle.js PASS；git diff --check（含staged新文件）PASS。没有安装依赖、修改package或build。
22. **生产bundle**：与037841a3字节完全相同，SHA-256=05d031cda7813d526f9f50956a789b0f4ec26c210a55bdf8c41abe2985874059。没有修改生产页面、Router、Risk、Chime、Unified、model或Step2/3实现。
23. **真实行情验证**：本轮未取得/导入实际TradingView Market Bundle，也未调用TradingView API/MCP/页面。**Engine 已通过 synthetic POC，真实 TradingView 数据现场验收尚待后续 Market Bundle。** CLI实际synthetic读入、100次一致和字节保持通过；不冒称真实数据验收。
24. **新发现设计问题/限制**：无必须改变Step1–3结构的冲突。冻结Step3旧文档有context fallback遗留文字，本轮沿用修复代码/明确授权，旧文档不改。OHLC不能证明边界print时间，因此open/close也仅possible；gap尚无交易日历解释；provider/exact/expiry声明只校验内部一致，真实性待实际producer验收；proxy不做基差/乘数/连续调整；partial detail完整铺棒要求较保守；canonical identity非紧凑hash，大文件非流式。定向测试的静态purity检查初次命中本地变量window，已改为requestedWindow；所有业务案例通过。以上均显式记录，不扩展到Policy。
25. **停止边界**：仅一个Step4A本地commit；未改main、未merge/push/deploy/Pages，未改线上版本；未进入PB/BOF Policy、Giveback、动态Stop、Replay Trace/Hard End/PostExit、Step4B或#/exit-research UI、TradingView网络接入、VPS/Webhook/Cloudflare。

## 40类要求的 Synthetic 对照

全部在 test/market-metrics.test.js 的 S4A 01—S4A 40 中具名验证。

| 编号 | 内容 |
|---|---|
|01|LONG risk；Entry=0R/Stop=-1R|
|02|SHORT risk/R方向|
|03|非法LONG Stop|
|04|非法SHORT Stop|
|05|zero risk|
|06|两方向2/4/6/8/10R threshold|
|07|LONG MFE|
|08|SHORT MFE|
|09|LONG MAE/负worstR|
|10|SHORT MAE|
|11|完全holding中的5M棒|
|12|Entry正好open|
|13|Exit正好close、下一棒不侵入|
|14|Entry mid-bar确认/可能界|
|15|Exit mid-bar确认/可能界|
|16|同一棒入出场|
|17|1M消除入场前5M极值|
|18|1M仍有分钟内歧义|
|19|confirmed milestone及棒区间|
|20|possible boundary milestone|
|21|多个milestone同棒区间|
|22|missing window/不替代真实Exit|
|23|持仓内gap|
|24|exact source/正常研究质量|
|25|same-expiry proxy flags/统计隔离|
|26|continuous proxy两个flags|
|27|context不进入execution extrema|
|28|wrong-market detail拒绝|
|29|duplicate bars拒绝|
|30|unsorted bars不排序|
|31|不可能OHLC拒绝|
|32|负volume拒绝|
|33|metadata/bars content identity|
|34|createdAt/外部ID不改content identity|
|35|100次计算完全一致|
|36|deep-frozen输入与输出独立|
|37|Step3 BLOCKED不洗白|
|38|显式context优先|
|39|null context研究解析、原对象不改|
|40|GC/ES/CL默认context配置|

逐秒oracle用人工确定价格序列生成OHLC，对8种holding窗口×LONG/SHORT两方向，独立计算真实极值并验证 confirmed≤truth≤possible；confirmed/NOT_REACHED milestones不反向声称触及。不是用户真实tick/行情，也不代替实际TradingView source验证。

## 复核命令

```bash
npm test
npm run build
node --check dist/app.bundle.js
git diff --check
node scripts/qa-market-metrics.mjs <ResearchTrade.json> <MarketDataBundle.json>
```

CLI默认不输出Account/Fill IDs、rawbars/provider symbols/交易日期价格或canonical identities；只输出研究R及结构化状态，源文件只读。
仓库只synthetic OHLCV/交易身份与规范；真实用户JSON/CSV/行情均未复制提交。原Step3 worktree的两份文档修订与.DS_Store未改、未带入Step4A。
