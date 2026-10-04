# Exit Research Step 4B — 中文完成与验证报告

完成用户附件明确授权的纯研究 Policy Replay；一个独立本地 commit 后停止，等待人工验收，不自行 FROZEN。
本报告与 EXIT_RESEARCH_STEP4B_SPEC.md 一并作为人工审计材料。

1. **分支**：codex/exit-research-v0-step4b-policy-replay，独立 managed worktree exit-research-v0-step4b。
2. **Base**：33ca4cf7e886001e6af63e6c14bccd981cc71798。没有修改/覆盖 Step4A 分支、Step3 pending 文档或 main。
3. **Step4B commit SHA**：最终交付消息返回完整 SHA；提交包含本报告，以避免 SHA 自引用，亦可用 git rev-parse HEAD 核对。
4. **新增文件**：13个，只新增 src/exit-research/{policy-schema,policies-v1,protection,execution-model,replay-data,replay-request,replay-engine,replay-trace,lookahead-qa,replay-quality}.js、test/policy-replay.test.js、docs/EXIT_RESEARCH_STEP4B_SPEC.md、本报告。所有既有 tracked 文件不变。
5. **Policy Schema**：精确字段、V1/versioned IDs、setupClass、pairedPolicyId、EXPERIMENTAL_BASELINE、stages、禁止loosen、NEXT_BAR_AFTER_CONFIRMATION、执行模型版本。stage name唯一、activate递增、giveback合法、minimumLock默认null、forceExit与HARD一致；未知字段/范围重叠/非法配置失败闭合。详细字段见 SPEC。
6. **PB/BOF Baseline**：PB activation0/2/6/8/10，BOF0/2/4/6/8，动态giveback30/25/20%。RUNNER保持Initial Stop，无自动BE；Soft Ceiling只stage不退出。全部为实验参数，不是最终交易规则/建议。
7. **Variants**：PB/BOF_TIGHT_GIVEBACK_V1仅改25/20/15%，activation不变；PB/BOF_HARD_CEILING_V1在PB10/BOF8R确认后下一棒market exit。六个配置冻结为只读，Engine查配置而不是散落PB/BOF阈值分支。
8. **事件循环**：每5M先应用pending→已有gap stop→已确认hard ceiling market order→已有普通stop；退出则不读取本棒extreme。存活至5Mclose后更新known MFE/milestones→人工状态→stage确认→nextProtection；下一棒才有效。detail不改变确认周期。
9. **policyKnownMfe**：只由存活的完成5M内完全可确认的post-entry路径计算，从0R累计。与描述性possibleMaxR/最终Research MFE区分；不读真实ExitPrice，也不读未来棒。退出触发棒内的high不回填最终known MFE。
10. **Protection**：max(previous theoretical protection, knownMfe*(1-givebackPct), optional minimumLock)，单调不放宽。继承值即使在PB RUNNER没有动态rule也保留。统一R沿用frozen1R/方向公式。
11. **Tick**：只接受显式可信executionTickSize；LONG向下、SHORT向上，微小表示误差修正。不读取proxy/display tick。无tick→理论值＋TICK_ROUNDING_UNAVAILABLE/REVIEW；Initial Stop离网格直接BLOCKED，不改frozenStop。结果区分理论R、rounded R与执行price。
12. **Stop fill**：LONG open<=Stop gap按open；否则low<=Stop按Stop；SHORT对称。NONE_V1，无额外slippage。普通棒内stop保留时间区间，simulatedExitTime=null；gap/ceiling/HardEnd使用明确model时点，不伪造秒级Broker Truth。
13. **BOF→PB**：MANUAL_ACTUAL保留rawevent和recordedAt，midbar10:47:20→10:50；恰好10:50→10:55。按累计MFE映射paired PB，继承1R/MFE/protection；不改原setup/event。FIXED_INITIAL_SETUP明确忽略人工切换而保留trace；RESEARCH_TRANSITION_RULE枚举预留但NOT_CONFIGURED/BLOCKED。撤销也按记录时点下一棒处理，不retroactive删除曾生效转换。
14. **Hard Ceiling**：确认棒不threshold fill，下一open执行。既有gap stop优先；若open未穿stop，ceiling market exit优先于稍后intrabar stop。HardEnd恰好确认ceiling且无下一棒时仍HardEnd退出。
15. **Replay Hard End**：必须运行前外部给定，严格晚于Entry，Engine不猜市场收盘。完整5Mclose使用close；midbar必须有一致的completed detail close或identified explicit mark，否则BLOCKED。若不完整片段可能已触stop，单个mark不够，HARD_END_STOP_BOUNDARY_AMBIGUOUS。实际Exit不终止Replay。
16. **Replay Request**：独立purpose=POLICY_REPLAY、Entry→预定HardEnd、5Mprimary、overlap bars、providerSymbol=null。原Step4A Actual Holding request不变。执行路径缺数据阻断；已先合法退出则无需伪造之后bars/到HardEnd的覆盖。
17. **Trace**：sequence/type/at/causeSequence＋当时已知字段；ENTRY/INITIAL_STOP/BAR_STARTED、MFE/milestone/stage确认、manual记录与switch、生效保护、stop/ceiling/HardEnd/blocked因果链。trace.at为证据报告时点，普通stop fill另用区间。早期trace不保存未来/最终字段。
18. **Lookahead QA**：auditReplayLookahead独立验证bar prior state、5M causal next state、known MFE证据、policy/math、manual raw timing、cause顺序和future字段；Engine传原Bundle交叉核对execution/evidence/fill/HardEnd mark。人为注入samebar stop、futureMFE、earlyeffect、错误source、fakefill/timeinterval等fixture→FAIL。未来棒/边界possible高点扰动保持早期trace相同。PASS是有限证据检查，不是形式证明；独立path oracle补强验证。
19. **Replay Result**：V1 IDs/三种模型版本/setupSource/sourceMode、完整policyDefinitions、market/bundlefingerprint/provenance、预定start/end、risk/tick/mark、simulatedexitprice/R/time或range/reason、knownMFE、finaltheoretical/rounded protection、finalpolicy/stage、lookaheadPASS/FAIL、quality/statisticsEligible、trace/auditBars。只为独立Research Derived Data，无持久化/生产接入。
20. **Quality**：集中assessReplayQuality；前序BLOCKED不能升级，REVIEW不能升级。invalidrisk/policy/time/coverage/market-detail conflict、HardEnd/Stop boundary无法执行、QA非PASS→BLOCKED，simulated exit字段清空。proxy/no trusted tick/entrypartial等REVIEW；exact+原READY+有效覆盖+QA PASS+无关键歧义才READY。proxy默认不进入正式exact统计。
21. **Synthetic Tests**：新增87项具名S4B测试；01–50逐项对应附件最少要求，51–87补充请求分离、撤销/事件边界、entry/end stop歧义、detail/mark、proxy/tick、source QA、未来扰动、数据驱动、跨时区、frozen接口集成、malformed输入等。独立ordered price path oracle覆盖16 seeds×LONG/SHORT×PB/BOF×3 variants=192配置。100次完整result相同、deepfreeze输入不变。清单见下表与测试源码。
22. **测试/构建**：冻结base482；最终npm test **569/569 PASS**，0 fail/skip/cancel（新增87）。npm run build PASS；node --check dist/app.bundle.js PASS；git diff --check（含staged新增文件）PASS。无新依赖/package/build改动。
23. **production bundle**：与33ca4cf7冻结base逐字节相同；SHA256=05d031cda7813d526f9f50956a789b0f4ec26c210a55bdf8c41abe2985874059。model/Unified/Risk/Chime/router/index/app/Pages/module list完全不改。
24. **真实行情Replay**：没有获取/导入任何真实TradingView行情，不连接行情API/MCP/账户，也没有broker验证。本轮Engine已通过synthetic POC，真实行情Replay验收尚待独立可信MarketBundle、tick和人工验收；不能称为真实行情通过或交易规则验证。
25. **新发现设计问题/限制**：无须改变Step1–4A frozen结构。OHLC不提供普通stop秒点，因此保留null+interval；边界可能触stop时不造fill。转换撤销不retroactive，以事件序列维护已发生历史。gap没有交易日历，不区分休市与漏数据；market/proxy/tick真实性仍需数据生产者确认；canonical identity不是认证；audit ledger非流式且随bars增长；明确hardendmark也不能证明未知片段没触stop；单纯two-argument QA不核对原Bundle，人工复核应传Bundle。首轮少量测试失败均定位为样本/预期问题（浮点比较、后续MFE增长、实际已先触保护、冻结接口枚举/helper），修正后全部通过；schema malformed相邻stage保护也已补齐并回归。
26. **停止边界**：只一个独立本地Step4B commit，等待人工验收。未改main、未merge/push/deploy/Pages；未改生产UI或开发#/exit-research；未进Step5；无自动Entry/PB/BOF识别、加仓/分批退出、网络/Webhook/VPS/Cloudflare。

## 最少50项测试对照

| 编号 | 测试验证 |
|---|---|
|01–05|PB INITIAL/RUNNER/PROTECT/EXTREME/SOFT_CEILING activation表|
|06|BOF全部stage与2R不自动BE|
|07–09|giveback30/25/20%数学|
|10|Tight只改保护强度、Engine结果|
|11|保护不放宽、可选minimumLock|
|12|本棒创新高+回撤不能用新stop打本棒|
|13|下一棒新stop生效和fill区间|
|14–15|LONG/SHORT normal stop|
|16–17|LONG/SHORT gap adverse open|
|18|no slippage与equal-open语义|
|19–20|LONG/SHORT保守tick rounding|
|21|无tick保留理论值、降级|
|22–24|转换1R/MFE不重置、保护继承|
|25|midbar manual→next5M|
|26|fixed setup忽略切换且保留事实trace|
|27|originalsetup/manualevents原对象不变|
|28–29|Hard Ceiling nextopen、不同棒threshold hindsight|
|30|Soft Ceiling不中止|
|31|Actual Exit/Price扰动不影响Replay|
|32–33|完整HardEndclose与midbar不读未来close|
|34|Replay范围缺数据阻断|
|35–36|possible entryextreme不能激活、confirmed detail只在5M确认|
|37|同棒milestones区间、不造秒级次序|
|38–39|trace因果及无future字段|
|40–41|独立QA PASS、故意错误fixture FAIL|
|42–43|100次确定性、deepfrozen不mutation|
|44–45|前序BLOCKED保持、proxy来源与质量|
|46–48|invalidpolicy/giveback/overlappingconfig failclosed|
|49–50|缺HardEnd、研究自动转换未配置拒绝|

## 额外测试与 Ground Truth

51–61：两个request窗口、exactmanualboundary、revert、entry/end stop歧义、detailalignedHardEnd、explicitmark、detailconflict、SHORT、open订单优先、初始Stop离tickgrid。
62–76：纯模块隔离、覆盖只需到exit、leading/intermediategap、前序REVIEW、stopbar不回填MFE、intraminute边界、未来manual、source/伪fill QA、六个实验configs、未来极值扰动、manualtiming造假、malformed输入、mark矛盾、无效risk/minlock、ceiling优先。
77：独立有序价格路径oracle，192配置；从给定点路径独立判断真实触stop/gap，按照规范的下一棒管理作对照。不是把Engine输出再代入同一个实现函数，也不是真实市场数据。
78–87：malformedstages、possible极值增大不改Policy、无HardEndrequest/显式series选择、customthreshold证明datadriven、Runner不BE、pre-entry已知manual、createdAt和UTC/Chicago/Shanghai一致、Step1–3真实frozen接口synthetic集成、stop时间区间造假、malformedidentity/pairedpolicy。

## 复核命令

```bash
npm test
npm run build
node --check dist/app.bundle.js
git diff --check
```

全部测试仅synthetic，未提交真实用户CSV/账户/Fill/Order或行情数据。
正式统计、真实broker成交、Policy收益优劣、上线均未验收；本轮只交付研究Engine与可审计因果证据。
