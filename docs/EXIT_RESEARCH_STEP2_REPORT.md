# Exit Research V0 Step 2 — 中文执行、测试与审计报告

日期：2026-10-04。仓库：xhb-D/intraday-task-cards。
分支：codex/exit-research-v0-step2。
基础 commit：ad197a07aae6a6dc4bf0df884aeb3517d599afb4。
Step 2 commit SHA 以最终交付回复及 git rev-parse HEAD 为准，避免 commit 内自引用。
状态：本轮实现及本地验证完成，等待人工验收；不自动标记 FROZEN。

## 修改文件与工程边界

- .gitignore：只忽略 /local-data/tradovate/，不忽略 Downloads，不复制真实 CSV。
- src/exit-research/csv.js：严格 CSV、结构化非敏感错误。
- src/exit-research/time.js：显式日历和 offset 解析。
- src/exit-research/tradovate-csv.js：三个 normalized parser 和重建输入校验。
- src/exit-research/logical-trade.js：Fills-only 交易重建。
- scripts/qa-tradovate.mjs：可重复的本地只读验收，只输出 header 和聚合。
- test/fixtures/tradovate/synthetic.js：人工合成字段 fixture，不含真实交易。
- test/tradovate-csv.test.js：38 个 CSV/时间/字段测试。
- test/logical-trade.test.js：21 个重建业务/确定性/边界测试。
- test/tradovate-qa.test.js：2 个 QA 隐私、BOM 与失败原子性测试。
- docs/EXIT_RESEARCH_STEP2_SPEC.md：业务/技术规范、审计和样本格式细化。
- docs/EXIT_RESEARCH_STEP2_REPORT.md：本报告。

复用原隔离 worktree，在冻结 commit 创建新分支；Step 1 分支指针保留基础 commit。
未修改 src/model.js、app.js、persistence.js、unified-persistence.js、index.html、Router、Risk、Chime、package.json、build、Pages 配置或工作流。
没有安装依赖。新模块无 DOM/localStorage/网络/当前时间/随机数，不通过虚假 import 接入生产 bundle。

## 实际样本编码与字段审计

三个文件均通过 UTF-8 严格解码，无 BOM、CRLF、末行有换行。
Fills 25 列/16 行；Orders 32 列/27 行；Position History 26 列/10 行。
ID 为十进制文本，归一化始终保留 string，不以 Number 排序；B/S 为外侧有空格的 Buy/Sell。
_quantity 为正整数；价格为十进制；Orders 金额有 quoted 千分位逗号，空可选字段为零长度字符串。
Fills _timestamp 为 YYYY-MM-DD HH:mm:ss.SSSZ；显示 Timestamp/Orders/Position timestamps 为 MM/DD/YYYY HH:mm:ss；Date 为 M/D/YY；Trade Date 为 YYYY-MM-DD。
Date/Trade Date 保留原文，不作为成交排序依据。
真实 Account/Fill/Order/Position/Pair IDs、日期、价格、P/L 行未写入本报告或 fixture。

### Fills.csv

```text
_id, _orderId, _contractId, _timestamp, _tradeDate, _action, _qty, _price, _active, _accountId, Fill ID, Order ID, Timestamp, Date, Account, B/S, Quantity, Price, _priceFormat, _priceFormatType, _tickSize, Contract, Product, Product Description, commission
```

### Orders.csv

```text
orderId, Account, Order ID, B/S, Contract, Product, Product Description, avgPrice, filledQty, Fill Time, lastCommandId, Status, _priceFormat, _priceFormatType, _tickSize, spreadDefinitionId, Version ID, Timestamp, Date, Quantity, Text, Type, Limit Price, Stop Price, decimalLimit, decimalStop, Filled Qty, Avg Fill Price, decimalFillAvg, Venue, Notional Value, Currency
```

### Position History (1).csv

```text
Position ID, Timestamp, Trade Date, Net Pos, Net Price, Bought, Avg. Buy, Sold, Avg. Sell, Account, Contract, Product, Product Description, _priceFormat, _priceFormatType, _tickSize, Pair ID, Buy Fill ID, Sell Fill ID, Paired Qty, Buy Price, Sell Price, P/L, Currency, Bought Timestamp, Sold Timestamp
```

## Normalized schemas

公共 result：{headers: 原始精确列名数组, rows: 新归一化对象数组, metadata}。
metadata：bom/newline/rowCount/kind/formatVersion/accountField/primaryTimeField/localTimezone/externalTimezoneConfigPending/numericRepresentationDifferenceCount。
sourceRowNumber 为物理源行起始号；rawFields 为原 row 字段映射，可在调用者的本地内存 QA 保留全部原文，绝不输出到本报告。

时间对象：{raw, normalized, sortKey, timezone, offsetMinutes}。
有明确 offset：sortKey 是 UTC ISO；无 offset：sortKey 是 sortable local calendar 字符串，timezone=unknown，offsetMinutes=null。
没有调用 Date.parse 或对无时区时间制造 epoch；只在明确 offset 时调用 Date.UTC。保留毫秒。

Fill：

```text
fillId, orderId, accountId, accountLabel, product, contract, contractId,
side: buy|sell, quantity, price, displayedPrice, priceSourceField,
fillTimeRaw, normalizedLocalTime, displayedTimeRaw, time, displayedTime,
active, commission, tradeDateRaw, sourceRowNumber,
numericRepresentationDifferences, rawFields
```

账户优先 _accountId，再 Account，两者都不存在才 null；不把可区分账户合并。price 优先机器 _price，保留显示 Price。
_timestamp 存在时必须合法，并作为排序依据；不存在时显式解析 Timestamp，时区 unknown。
不做 MGC→GC 或 MES→ES 之类 Task Card mapping。

Order：

```text
orderId, versionId, lastCommandId, accountId, accountLabel, contract, product,
side, quantity, orderType, status, filledQuantity, averageFillPrice,
reportedLimitPrice, reportedStopPrice, orderTime, fillTime,
dateRaw, notionalValue, currency, sourceRowNumber,
numericRepresentationDifferences, rawFields
```

机器 decimalFillAvg/decimalLimit/decimalStop 存在时保留机器值；空可选值为 null。
Stop 字段是 exported reportedStopPrice，绝不命名/解释为 initialStop。

Position History：

```text
positionId, pairId, buyFillId, sellFillId, accountId, accountLabel, contract, product,
netQuantity, netPrice, boughtQuantity, soldQuantity, pairedQuantity,
averageBuyPrice, averageSellPrice, buyPrice, sellPrice, pnl, currency,
time, boughtTime, soldTime, tradeDateRaw, sourceRowNumber,
numericRepresentationDifferences, rawFields
```

Position ID 不作为 Logical Trade 边界；P/L 仅解析原字段，不计算盈利好坏。

Logical Trade：

```text
logicalTradeId, status: closed|open, accountId, product, contract, direction: LONG|SHORT,
quantity, exitQuantity, remainingQuantity,
entryStartedAt, entryCompletedAt, entryVwap,
exitStartedAt, exitCompletedAt, exitVwap,
entryFillIds[], exitFillIds[], entryOrderIds[], exitOrderIds[], allFillIds[],
sourceRows[], fills[], qualityFlags[]
```

显式确认 Flat 后 reconstructLogicalTrades 返回原 {closedTrades, openPositions, fills, metadata}，交易数据结构不变；未确认时返回 WINDOW_START_FLAT_UNCONFIRMED，两个交易数组为空，数量统计 null，不代表已证明 flat。
metadata 包括 fillCount/groupCount/closedTradeCount/openPositionCount/flagCounts。
时间字段是完整 time object，fills[] 保留每次真实成交时间、字段和 provenance。

## CSV 行为与错误

支持 UTF-8 BOM、LF/CRLF、quoted comma/newline、escaped double quote、空字段、末行无换行。
不使用 line.split(',')。重复/空 header、列数不符、非法引号、非法关键字段、重复 Fill ID 均 fail closed。
quantity 为正安全整数（期货合约数）、price 为有限正数；只接受明确 Buy/Sell；ID 不可空；验证真实日历、时分秒/offset。
错误含 code/sourceRowNumber/field，message 只含这三项，不带整行、账户或成交价格。
包括 DUPLICATE_FILL_ID、MISSING_HEADER、COLUMN_COUNT_MISMATCH、INVALID_TIME、INVALID_NUMBER、INVALID_SIDE、INCONSISTENT_ALIAS 等。
raw immutable ID/quantity aliases 必须一致；不静默去重、跳行或修补非法记录。
_active=false 保留在 normalized row，但重建以 INACTIVE_FILL_UNSUPPORTED 拒绝，避免擅自猜 inactive/correction 语义。

## 重建算法与 ID

1. 完整校验输入，无原地修改；按 JSON tuple [accountId, exact contract] 分组。
2. 组内按明确 parsed time.sortKey、原 CSV sourceRowNumber 排序，不按 Fill ID 数值。
3. 从 net=0 开始；首次非零创建 LONG/SHORT 区间。同方向累计 entry，反方向累计 exit；回到0才生成 closed trade。
4. 保留第一/最后 entry fill 及第一/final exit fill，Actual Entry=entryStartedAt、Actual Exit=exitCompletedAt。
5. VWAP 为 quantity-weighted，以补偿求和减少浮点累计误差，无 tick/display rounding。不可表示的数值累计 fail closed。
6. 同 Entry/Exit Order 的多个 partial fills 合并为一笔，不误报 scale-in。quantity 是累计 entry 成交量；有 re-add 时不是峰值仓位。
7. ID=lt:+encodeURIComponent(JSON.stringify([accountId, contract, firstEntryFillId, finalExitFillId或null]))，没有当前时间/random/array index。Open ID 在后续变成 closed 时会变化。
8. 输出按账户合约组字典序、组内交易时间序稳定排列；fills 原输入顺序保留，trade.fills 按执行顺序保留。

## Reversal / Open / Quality Flags

跨零采用用户允许的 fail-closed：RECONSTRUCTION_REVERSAL_CROSS_ZERO，带源行号，不拆 synthetic components、不丢弃超量、不返回之前的半成品。
文件末尾 net!=0 单独进入 openPositions，exitCompletedAt=null；保留已发生的部分 exit 和所有 fills，无虚构 final exit。

全部质量标记：

| Flag | 触发 |
|---|---|
| MULTI_ENTRY_ORDER | 一区间有多个不同 entry order |
| MULTI_EXIT_ORDER | 一区间有多个不同 exit order |
| RE_ADD_AFTER_EXIT_STARTED | 第一次 exit 后再次增加原方向仓位 |
| UNSUPPORTED_SCALE_PATTERN | 上述任一种出现 |
| OPEN_POSITION_AT_FILE_END | 文件末尾非零仓位 |

普通同一 Order partial fill 不需 OK flag。多 Order 是保守研究 QA 标记，不自动断言业务动作意图；不删除交易，也没有 READY 决策功能。

## 真实 CSV 本地只读 QA

实跑：

```bash
node scripts/qa-tradovate.mjs --window-start-assumption=FLAT_CONFIRMED_FOR_QA <本地Fills路径> <本地Orders路径> <本地Position-History路径>
```

| 样本 | rows | accounts | contracts | parse errors | 数值表示差异 |
|---|---:|---:|---:|---:|---:|
| Fills | 16 | 1 | 2 | 0 | 2 |
| Orders | 27 | 1 | 2 | 0 | 5 |
| Position History | 10 | 1 | 2 | 0 | 0 |

本报告样本统计的前提：windowStartAssumption=FLAT_CONFIRMED_FOR_QA。即调用者已人工确认样本各账户/具体合约窗口起点 Flat 的条件下，仅基于 Fills：closed=5，open=0；MES=3、MGC=2。工具不自行证明此人工前提，也未执行初始券商仓位或三表对账核验。
16/16 Fill 均保留在交易 provenance；其中1笔同时有 MULTI_ENTRY_ORDER、MULTI_EXIT_ORDER、UNSUPPORTED_SCALE_PATTERN。
RE_ADD_AFTER_EXIT_STARTED=0、OPEN_POSITION_AT_FILE_END=0。没有三表 reconciliation；10个 History rows 不被当成10笔 Logical Trade。
三份 parser 和重建各重复100次，完全一致。读取前后源文件 SHA-256 比较一致；只在内存比较，不把源内容/指纹写入仓库。

初次实际 QA 暴露机器/显示数值不严格相等：Fills 两处、Orders 五处比较差异，均为1e-12量级。
根因是本轮对机器和显示字段的精确 Number 相等假设过强；两条人工合成回归先失败，修正后通过。
现使用 abs(a-b)≤8×Number.EPSILON×max(abs(a),abs(b)) 的严格价格表示检查；所有差异均记录字段名及 metadata 计数。
原文及机器数值均保留，不将机器价格舍入成显示价格，容差不参与 VWAP。更大的冲突仍拒绝。
未发现需要扩大范围的重大设计冲突。

## 隐私审计

真实 CSV 一直留在用户 Downloads；仓库仅 synthetic fixture 和 header/聚合统计。
提交前扫描本轮文件：真实账户、Fill/Order/Position/Pair/Contract IDs，以及真实交易日期和完整原始行未命中。
测试中的账户、ID、日期、价格和 P/L 都为人工设置；Product 名称和 header 仅是格式结构。
.gitignore 仅新增 /local-data/tradovate/ 的明确保护；真实数据未复制到该目录或任何仓库位置。
本地 QA 另有自动测试确认输出无合成 IDs/账户/价格/日期；失败没有部分结果输出。真实 QA 输出同样只有字段及聚合。

## 最终验证

基线304/304；最终366/366，0 fail、0 skipped、0 cancelled。
新增61条具名测试；node --test 另把新增 synthetic fixture 模块作为1个成功文件项计入总数，因此总数增加62。
新增覆盖全部用户指定20类 fixture 情形，另覆盖输入不变、非法时间、UTC/Chicago/Shanghai 三 Node TZ 环境输出一致、价格表示和 QA 隐私。

| 命令/检查 | 结果 |
|---|---|
| npm test | PASS 366/366 |
| npm run build | PASS exit 0 |
| node --check dist/app.bundle.js | PASS |
| git diff --check（包括 staged 新文件） | PASS |
| bundle 与基础 commit 精确比较 | PASS 字节完全不变 |
| 生产源文件/页面/package/build 与基线比较 | PASS 未修改 |
| 三个真实 CSV 本地只读 QA | PASS，100次确定性与源字节保持 |

bundle SHA-256：05d031cda7813d526f9f50956a789b0f4ec26c210a55bdf8c41abe2985874059，与冻结 Step1一致。
当前 Node v22.23.0；ESM/node:test，使用标准 structuredClone；未额外安装包。
审计开始前已有的未跟踪 .DS_Store 不纳入提交、不删除。

## 设计限制与停止边界

- 工具没有自行证明窗口起点 Flat；必须由调用者显式确认才按0重建，未确认不输出正式 Logical Trade。5笔为该人工确认条件下的结果，不把截断窗口推导称为完整券商历史真相。
- Orders/History 的无时区显示时间保持 unknown，Step3 时间口径/三表 QA 仍待将来授权。
- Reversal/inactive 本轮选择拒绝；若以后需要保留并拆分，需独立授权。
- 多订单标记保留异常事实；没有判断交易质量、盈利、R、止损、MFE/MAE。
- parser 是内存批处理，非流式；大文件规模不在本次样本验收证据内。

明确确认：仅一个 Step2 本地 commit；未 push、未 merge、未 deploy、未改 main 或线上版本；未进入 Step3、HTML自动匹配、TradingView行情、Replay Engine。
完成后停止，等待人工验收。


## 起点边界小修复验证（基于 ec24ff0）

本次只显式化边界，不变更交易算法、不进入 Step3/reconciliation、不改生产 UI 或部署。
API：REQUIRE_FLAT + 显式自身布尔 assumeFlatAtStart=true；不藏确认默认值。
未确认返回 WINDOW_START_FLAT_UNCONFIRMED，合法 Fills 副本保留、closed/open 空、数量 null。
KNOWN_INITIAL_POSITION 预留但尚未支持；返回 KNOWN_INITIAL_POSITION_UNSUPPORTED，不猜仓位。
QA 必须显式传入/输出 FLAT_CONFIRMED_FOR_QA；缺少确认时在读取文件前拒绝。
新增7条测试：未确认、显式正常、ec24ff0黄金边界/ID/VWAP100次比较、open-at-end保持、known模式、非法确认不可绕过、QA无确认拒绝。
另对修复前保存的合成完整输出 deepEqual，确认不仅 ID/VWAP/时间，完整结果也相同。黄金 fixture 全为合成账户/日期/价格/IDs，无真实 CSV。
全量373/373通过；npm run build、node --check dist/app.bundle.js、git diff --check通过，bundle 与 ec24ff0字节不变。
真实文件使用明确 QA 条件重新运行：5 closed / 0 open；MES=3、MGC=2；16/16 Fill保留，flags与前次相同；100次一致，源字节不变。
这里的人工确认是调用者给定的前置语义；本轮只验证该条件下的重建，没有独立验证初始仓位，不以运行结果反证起点 Flat。
本修复提交 SHA 以最终交付消息/git rev-parse HEAD 为准。仍只在 codex/exit-research-v0-step2 本地提交一个修复 commit，不 push/merge/deploy；完成后停止。
