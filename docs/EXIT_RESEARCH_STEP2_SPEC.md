# Exit Research V0 Step 2 — 业务与技术执行规范

基线：ad197a07aae6a6dc4bf0df884aeb3517d599afb4。
开发分支：codex/exit-research-v0-step2。用户已授权本轮本地实现和一个独立 commit；等待人工验收。

## 范围与隔离

仅 CSV parser、三份 normalized 数据及 Fills 驱动的 Logical Trade Reconstruction。
不改 Step 1 模型、存储、UI、Risk、Chime、Router、部署和构建模块列表。
不 push/merge/deploy、不做三表 reconciliation、HTML 匹配、行情、Replay、R/止损/MFE/MAE/政策结果。
真实 CSV 只从用户 Downloads 读取，绝不复制进仓库；测试使用人工合成 IDs、账户、日期、价格和 P/L。

## 前置审计与 Level 1 Reuse Assessment

已读取 model/persistence/unified-persistence、package/build、test 结构及 Step 1 spec/report。
Step 1 文档仍记早期 292 测试及未冻结状态；本轮基线以用户冻结授权和实际 ad197a0 为准，包含平仓原子性修复，基线实跑 304/304。
仓库无 CSV parser；已有纯 ESM + node:test，无运行时依赖。build 使用固定模块列表，不需为新模块调整。
检查 Papa Parse（https://github.com/mholt/PapaParse，MIT）和 node-csv（https://github.com/adaltas/node-csv，MIT），均有文档、测试和长期历史；本轮未深入核验最新发布/维护响应，维护活跃程度 UNKNOWN。
二者可覆盖通用 CSV，却均不能直接覆盖本轮的实际 header、时间/ID 校验及 execution 业务规则；引入会增加依赖、打包及升级责任。
按用户已明确的零新增依赖、严格 fail-closed、独立模块路径，本轮自写有限 CSV 状态解析器；外部项目仅参考能力边界，不复制代码。
反证：成熟库具有更广泛格式/大文件测试，自写 parser 有自维护成本；V0 不支持自动 delimiter detection、流式/worker/任意日期格式，采用严格测试固定行为。
CSV 列数不一致拒绝参考：https://csv.js.org/parse/options/relax_column_count/ 。

## 输入与归一化

CSV 解析接受 UTF-8 解码 string；移除开头 BOM，支持 CRLF/LF、quoted comma/newline、escaped quote、空字段及末行无换行。
Header 保留精确拼写与顺序，拒绝空/重复 header、列数不一致、非法引号；不静默跳过中间空行。
sourceRowNumber 为物理行号（header=1；多行 quoted 字段保留起始行）。结果完整成功或抛出含 code/sourceRowNumber/field 的非敏感错误。
三 parser 返回 {headers, rows, metadata}；metadata 含类型、格式版本、行数、BOM、换行及时间/账户字段来源，无当前时间。
Fills 必需 header：Fill ID, Order ID, Contract, Product, B/S, Quantity, Price, Timestamp。
若存在 _timestamp 则必须合法并作为排序时间；_id/_orderId/_qty 与显示字段存在时必须严格一致；_price 与 Price 检查机器浮点表示差异；不猜 _action 数值语义。
账户优先 _accountId，其次 Account；两者均不存在才 accountId=null，不混合可区分账户。保留 accountLabel 和 contractId。
数量为期货合约正安全整数；价格为有限正十进制；ID 非空 string（不转 Number）。Buy/Sell 允许外侧空格，未知 side 拒绝。
填充数据中的 _active=false 不用于偷偷删除事实，归一化保留 active 并在重建时 fail closed，等待明确 inactive/correction 语义。
Orders 保留订单/版本/命令 ID、type/status/side、quantity/filledQuantity、reportedLimitPrice/reportedStopPrice/averageFillPrice、orderTime/fillTime、contract/product/account。
Position History 保留 positionId/pairId/buyFillId/sellFillId、net/bought/sold/paired quantity、prices、pnl/currency、三种 timestamp；不按 Position ID 决定交易边界。
空可选数值/时间归一化 null；非法非空数值拒绝；P/L 可为负数；金额支持正确千分位逗号。Orders Stop 绝不称 initialStop。

## 时间

显式解析样本格式 MM/DD/YYYY HH:mm:ss 和 YYYY-MM-DD HH:mm:ss.SSSZ；另支持 ISO T 分隔与显式 ±HH:mm offset。
验证真实日历、时分秒和 offset。无时区形成 YYYY-MM-DDTHH:mm:ss.SSS、timezone=unknown、offsetMinutes=null，不生成虚构 epoch。
明确 offset 的 sortKey 为明确 UTC ISO 字符串；Date.UTC 只用于明确 offset 时间，不调用 Date.parse。
Normalized Fill: fillTimeRaw, normalizedLocalTime（显示 Timestamp，时区未知）, displayedTimeRaw, time（raw/normalized/sortKey/timezone/offsetMinutes）、displayedTime。
没有 _timestamp 时，time 使用显式解析的 Timestamp；同账户合约内混合有/无 offset 的时间拒绝，不推断时区。

## Logical Trade

接口 reconstructLogicalTrades(normalizedFills)；输入不原地排序/修改，完整校验再创建结果。
按 accountId + exact contract 分组；每组按 time.sortKey，然后 sourceRowNumber 排序，不按 Fill ID 大小排序。
净仓由 0→非0 开始，回到0关闭；正仓 LONG，负仓 SHORT。Orders/Position History 不参与。
同方向 fills 为 entry components，反方向 fills 为 exit components，保留所有原始归一化 fill。
quantity=累计 entry quantity；另保留 exitQuantity/remainingQuantity。存在 re-add 时 quantity 是累计成交量而非峰值仓位。
entryStartedAt/entryCompletedAt 为第一/最后 entry fill；exitStartedAt/exitCompletedAt 为第一 exit/归零 fill。Actual Entry=entryStartedAt，Actual Exit=exitCompletedAt。
VWAP=Σ(price×qty)/Σqty，使用补偿求和、无 tick/display rounding；不可表示的累计量/金额拒绝。
同一订单 partial fills 合并不报 scale flag。不同 entry order: MULTI_ENTRY_ORDER；不同 exit order: MULTI_EXIT_ORDER；退出后补仓: RE_ADD_AFTER_EXIT_STARTED；任一出现同时标记 UNSUPPORTED_SCALE_PATTERN。不删除交易。
Reversal 选择用户允许的 fail-closed 路径：RECONSTRUCTION_REVERSAL_CROSS_ZERO；不拆分、不丢弃超量、不返回先前半成品。错误只含源行号/字段。
文件末尾非零输出 openPositions，status=open、OPEN_POSITION_AT_FILE_END、exitCompletedAt=null，保留已发生的部分退出和所有 fills，不虚构 exit。
ID 为 lt: + encodeURIComponent(JSON.stringify([accountId, contract, firstEntryFillId, finalExitFillId或null]))；保留 tuple 避免拼接碰撞，既不随机也不依赖时间/数组下标。Open ID 随未来完成会变化。
返回 {closedTrades, openPositions, fills, metadata}；所有来源 rows/IDs/fills 和 flags 可审计。相同文件重复100次完全一致。
未能从完整导出证明文件起点一定 flat：V0 按用户定义从0重建，不能把 truncated 文件的输出宣称为完整券商历史真相，Step 3 不在本轮开发。

## 实施与验收顺序

1. 严格 csv.js/time.js，三 parser 及 synthetic 字段 fixtures。
2. 纯重建逻辑，覆盖 flat、partials、long/short、多合约/账户、相同时间、scale flags、open 和 reversal。
3. 真实样本本地只读 QA，只报告 headers 和聚合数量；隐私扫描待提交文件。
4. npm test、npm run build、node --check dist/app.bundle.js、git diff --check；bundle 字节与基线完全一致。
5. 提交一个 Step 2 commit；停止等待人工验收，不标记最终验收 FROZEN。

## 样本验证后的价格表示细化

真实 Fills 机器/显示价格两处差异均为 1e-12；Orders 的 avgPrice/decimalFillAvg/decimalStop 也存在同量级差异。
不是用显示舍入修改执行价格：Fills.price 优先 _price，displayedPrice 保留 Price；rawFields 永久保留两列原文。
价格 alias 比较仅允许 abs(a-b) ≤ 8×Number.EPSILON×max(abs(a),abs(b))，任何差异均记录 numericRepresentationDifferences，并在 metadata 计数；超过范围仍 fail closed。数量和 ID 不使用容差。
Orders 优先 decimalFillAvg/decimalLimit/decimalStop 作为中性价格字段；显示原文仍完整保留。此容差仅用于浮点表示校验，不参与 VWAP 舍入或 tick 对齐。
