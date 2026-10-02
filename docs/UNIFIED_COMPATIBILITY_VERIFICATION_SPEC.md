# 统一交易控制中心 — Data Compatibility & Verification Spec

- 状态：APPROVED VERIFICATION BASELINE / 本次统一 schema-v2 与 Natural Chime 实现已获明确授权；本地验收待完成
- 版本：2.1
- 日期：2026-10-02
- 对应 Business / Architecture Spec：2.1
- 修订：增加统一顶层 schema 1→2 与 Natural Chime 兼容矩阵；继续验证日内 section V3→V4、旧活动机会安全结束/审计、风险管理器、冲突保护和滚动位置保持性。

## 1. 目标

证明冻结的日内 V4 与 Natural Chime 规则正确实施；统一顶层 schema 1→2 只增加并验证 chime 且值级保留 intraday/risk/preferences；旧历史名称/关键位置不改写、不丢失风险数据；损坏、未知版本、歧义、并发或存储失败均不会静默覆盖数据。

## 2. 基线与范围

- 当前 canonical key 仍为 `trading-control-center:v1`；统一顶层当前 schema 为 2，升级来源 schema 1。
- 当前日内 envelope/state 为 V4；risk section/schema 2；新增 chime section/schema 1；preferences 原有字段保持。
- 当前统一 JSON 中嵌套的日内 V3 只允许走严格、确定性的 V3 → V4 迁移。
- 独立日内状态卡备份（V1/V2/V3）仍明确拒绝；独立风险备份继续兼容风险 schema 1/2。
- 私密真实备份只在本地只读验证，不复制到仓库；仓库夹具只能使用脱敏合成数据。
- 风险管理器的数据、公式、业务规则和迁移器不因日内升级改变。

## 3. 测试分层

### 3.1 纯函数测试

- 偏见/方向九种组合；
- 结构/方向/机会可选性；
- 单商品单机会、幂等、切换收尾；
- 立即登记和无位置生命周期；
- V4 不变量、legacy history 保持、迁移审计；
- 格式分类、顶层与当前 section 校验、序列化往返、错误路径和重复导入幂等性。

### 3.2 存储适配器测试

- canonical 缺失时旧风险键兼容恢复；
- canonical V2 优先，永不重吸收 `natural-chime-settings`；
- canonical top-level V1→V2 deterministic migration with exact intraday/risk/preferences equality;
- separately applicable nested intraday V3→V4 migration;
- one-time absorption of only the verified legacy chime V1 shape; explicit legacy chime version 2 and all corrupt/unknown/unrepresentable inputs use safe recovery;
- pre-import 快照、写入后回读、配额/异常和多标签页 revision 冲突；
- 损坏或未知版本恢复保护，原始字符串保持不变。

### 3.3 DOM / 浏览器测试

- 可见顺序、固定标题和按钮文案；
- 三种偏见下做多/做空/暂无方向都不被禁用；
- 新机会三按钮、结构选择和方向前置条件；
- 位置输入、确认按钮和旧登记提示不存在；只读入场提示精确匹配；
- 历史旧位置保留、新记录显示 `—`；当前摘要不显示位置；
- 导入预览与确认、首页/风险视图切换、刷新、返回、前进、三种主题、桌面与窄屏、`file://` 降级；
- 页面点击、重绘、折叠、隐藏/恢复商品的滚动位置保持。

### 3.4 发布产物测试

- `npm run build` 更新生产 bundle；
- `node --check dist/app.bundle.js`；
- index 资源版本一致、无网络依赖、无旧 bundle 混载；
- 本地 localhost 预览可打开并供用户验收；本轮不执行 commit 或 Push。

## 4. 必测兼容矩阵

| ID | 输入/场景 | 预期 |
| --- | --- | --- |
| C01 | canonical 缺失且旧风险键有效 | 风险迁移到统一 key；风险键字节不变 |
| C02 | 独立日内状态卡备份或旧键 | 不读取、不迁移；导入明确拒绝且零副作用 |
| C03 | 仅旧风险键存在且无 canonical，无论 legacy chime key 状态 | 风险迁移；创建合法空白 GC/CL/ES V4 和冻结默认 chime；legacy chime key 完全不读取、不检查、不吸收 |
| C04 | unified V2 canonical 已存在，legacy chime key 同时存在或损坏 | 只校验/读取 V2 canonical；不读、不重吸收 legacy chime key |
| C04a | 有效 unified V1 canonical + 已核实的 legacy chime V1（version 缺失或数值 1） | 自动迁移到 unified schema 2；只新增 chime；intraday/risk/preferences 深相等；sourceVersion=1；legacy key 字节不变 |
| C04b | 有效 unified V1 canonical + legacy chime `version: 2` | 不推测格式、不写 canonical；进入精确只读恢复，canonical 与 legacy key 字节不变；显式忽略后才以默认 chime 执行受 guard 迁移 |
| C04c | unified V1 canonical 无 legacy chime key | 自动迁移到 V2 并写冻结默认 chime；intraday/risk/preferences 深相等 |
| C04d | unified V1 canonical + corrupt/unknown/unrepresentable legacy chime（包括 `version: 2`） | 不写任何 canonical；显示已验证 intraday/risk 只读、禁用报时并锁定写入；精确显示 Business Spec §6 唯一文案 |
| C04e | 用户在 C04d 明确确认“忽略旧报时设置并使用默认值继续” | 受 revision/raw guard 的 V1→V2 一次迁移成功；chime 用 defaults；canonical 有已验证快照，legacy bytes 不变 |
| C04f | 无 canonical，legacy chime V1、`version: 2`、损坏或未知 | 完全不读取、不检查、不校验、不吸收 legacy chime key；直接以默认 chime 执行现有 bootstrap，legacy bytes 不变 |
| C05 | 当前统一顶层 V2 存档 | 正常恢复，严格校验 intraday/risk/chime/preferences；独立日内旧键仍不读 |
| C06 | 独立状态卡 schema 1/2/3 | 全部拒绝，不迁移 |
| C07 | Unified V1 输入中的嵌套日内 V3 空白 | 按既有独立阶段确定性迁移到 V4；风险、外观和 GC/CL/ES 隔离保持；之后 envelope-only V1→V2 阶段深相等保持已验证 V4 section |
| C08 | Unified V1 输入中日内 V3 有旧历史 | 旧 type、旧 zone、时间线和原始含义保留，不重命名 |
| C09 | Unified V1 输入中日内 V3 有已登记活动机会 | 以 `rules_upgrade` 安全结束，写升级原因和审计，卡片无活动机会 |
| C09a | Unified V1 输入中日内 V3 有已登记活动持仓 | 保留 `enteredAt` 与完整 `wait → position` 时间线，仅结束末阶段；`reason = rules_upgrade`、迁移原因和审计正确 |
| C10 | Unified V1 输入中日内 V3 有未登记活动机会 | 安全结束，不伪造普通交易历史；写完整 migrationAudit |
| C11 | V3 迁移时间 | 同一输入每次结果相同，`migratedAt` 为 savedAt/时间线最大值 |
| C12 | V3 损坏、timeline 断裂、身份不一致 | fail-closed；原始统一存档保留，不写部分结果 |
| C13 | 风险 schema 1 | 迁移到 2；旧快照冻结；`hardLossAmount = null` |
| C14 | 风险 schema 2 | 账户、选择、时段、事件和风险快照往返相等 |
| C15 | Unified V1 file import | 既有适用的 intraday V3→V4 先迁移，再补默认 chime；不得读本机 legacy；预览→确认→快照→revision/raw guard→单次 commit→回读 |
| C15a | Unified V2 file import | 所有 section/preferences 严格校验；预览确认后完整替换并单次提交/回读 |
| C16 | 旧风险分项导入 | 仅 riskManager 改变；日内、chime、外观和非风险审计保持 |
| C17 | 非法 JSON / 未知顶层或 section 版本 | 拒绝；存储、内存、DOM 零变化；不得跳过未知 section |
| C18 | 重复账户/会话/事件 ID、断裂余额链、delta 错误、非法时间戳 | 拒绝并定位字段，不静默修补 |
| C19 | 文件超过 8 MB | 解析前拒绝 |
| C20 | 写 canonical 失败或写后回读不一致 | 旧值保留/安全停止；导出仍可用 |
| C21 | 写 pre-import 快照失败 | 不开始正式导入 |
| C22 | 导入确认前另一标签页写入 | 取消确认；不得覆盖新 revision |
| C23 | 同一当前统一备份重复导入 | 第二次结果相同，不重复迁移或新增记录 |
| C24 | 偏多/无偏见/偏空 × 做多/做空/暂无方向 | 九种组合均可选择，方向按钮不被 bias 禁用 |
| C25 | 已选结构 × 做多/做空 × 三种新机会 | 全部三种新机会均可选择；无方向或 unjudged 全部禁用 |
| C26 | 同一机会重复选择 | revision、ID、登记时间、阶段时间和 records 不变 |
| C27 | 切换机会 | 旧记录按取消语义结束；新记录立即写入；仅一个活动机会 |
| C28 | 新机会等待/找信号/入场/平仓 | 全流程不读取或要求关键位置；历史新记录 zone 为 `null` |
| C29 | 旧历史/新历史 UI | 旧关键位置原值保留；新记录历史列显示 `—`；当前摘要无关键位置 |
| C30 | GC、CL、ES 并行操作 | 商品状态、机会、记录和迁移 audit 相互隔离 |
| C31 | 风险管理器回归 | 风险公式、数据、独立导入导出和页面流程不漂移 |
| C32 | 页面点击和重绘 | 既有 scroll position、折叠/隐藏商品、焦点路径保持 |
| C33 | `#/risk` 硬刷新、浏览器返回/前进 | 同一 index 正确恢复；不重复初始化视图 |
| C34 | 生产 bundle | bundle 与源码规则一致、可语法检查、无网络依赖 |

## 5. 关键断言

### 5.1 迁移零副作用

迁移或导入失败前后必须满足：

```text
afterMemory === beforeMemory
afterStorageRaw === beforeStorageRaw
```

成功迁移只能在完整校验通过后一次提交；原 V3 raw 只可作为诊断/回退输入保留，不能被空白覆盖。

Top-level unified V1→V2 envelope-only migration has these exact success assertions:

```text
deepEqual(after.sections.intraday, validatedBeforeEnvelope.sections.intraday)
deepEqual(after.sections.riskManager, validatedBeforeEnvelope.sections.riskManager)
deepEqual(after.preferences, validatedBeforeEnvelope.preferences)
after.schemaVersion === 2
after.revision === validatedBeforeEnvelope.revision + 1
after.savedAt === validatedBeforeEnvelope.savedAt
validChimeV1Section(after.sections.chime)
```

Here `validatedBeforeEnvelope` is the fully validated schema-1 envelope after any separately authorized existing nested-section migration. If an input also requires the already-existing nested intraday V3→V4 migration, verify that migration separately against its V3→V4 Ground Truth; then verify the envelope-only transformation preserves the resulting validated V4 intraday section exactly. The two transformations may not be conflated in the test oracle.

For corrupt/unknown local legacy chime during the first local unified-V1→V2 migration, verify the single recovery message exactly:
`旧版报时设置无法识别，报时已停用；原始存档与旧键均未修改。请恢复有效统一备份，或明确选择“忽略旧报时设置并使用默认值继续”。`
Before explicit ignore, canonical raw (if present), legacy raw, memory business data, and DOM business values remain unchanged; any validated intraday/risk display is read-only and every write is locked. After explicit confirmation, defaults are used and legacy raw remains byte-for-byte unchanged.

### 5.2 旧历史保持

对每条迁移前已结束或活动的旧记录，核对：

```text
after.type === before.type
after.zone === before.zone
after.symbol === before.symbol
```

允许的变化仅为活动机会的确定性结束字段、`rules_upgrade` 结果和 `migrationReason` 审计字段。

### 5.3 新机会登记

选择新机会成功后必须同时满足：

```text
card.opportunity.id === records.at(-1).id
records.at(-1).registeredAt === choiceTime
records.at(-1).zone === null
```

同机会重复选择前后深度相等，切换机会后旧记录不再活动且只有一个 card opportunity。

### 5.4 四方一致性

每次启动、迁移、导入和关键恢复后对照：

1. 备份 payload；
2. 校验/迁移后的内存 state；
3. canonical localStorage；
4. DOM 中的当前选择、状态、账户和风险结果。

四方任一不一致即不通过，不得仅凭页面能打开验收。

## 6. 验收报告要求

实现后的 Verification 报告必须列出：

- 实际测试命令、日期和通过数量；
- Schema-1→2 and nested intraday V3→V4 migration results as separate rows, with before/after deep-equality evidence for intraday/risk/preferences;
- legacy chime verified-V1/absent/explicit-version-2/corrupt/unknown/unrepresentable source, exact recovery text, explicit-ignore behavior, unified schema-1/schema-2 import and risk-only isolation;
- 全量回归、核心规则和兼容矩阵结果；
- `npm run build`、`node --check`、`git diff --check`；
- 本地 localhost URL、浏览器和人工检查范围；
- 旧历史/活动机会迁移的合成证据，不含真实账户名或余额；
- 未完成实机或公开 Pages 项目；
- 未创建 commit、未 Push 的事实和回退边界。

## 7. Release blocker

以下任一情况存在时禁止发布或标记 FROZEN：

- V3 统一存档无法确定性迁移或旧历史 type/zone 漂移；
- unified top-level V1→V2 changes intraday/risk/preferences values, corrupt legacy is silently defaulted, legacy chime key is modified/reabsorbed, or v1/v2 import transaction order differs from spec;
- 旧活动机会仍作为活动机会、没有审计结束原因或迁移失败会覆盖原存档；
- 新机会仍依赖关键位置、方向按钮被 bias/结构矩阵错误禁用或同商品存在多个活动机会；
- 风险域、GC/CL/ES 隔离、统一导入导出或滚动位置回归失败；
- 生产 bundle 未更新或本地预览无法提供用户验收；
- 未获明确授权却发生 commit、Push 或其他超出范围的外部变更。
