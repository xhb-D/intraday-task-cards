# 统一交易控制中心 — Architecture / Technical Spec

> 2026-10-04 独立开发分支的 Exit Research Step 1 授权补充见 [EXIT_RESEARCH_STEP1_SPEC.md](EXIT_RESEARCH_STEP1_SPEC.md)。本分支日内版本为 V5，统一版本保持 V2；原文保留为 e25ba69 基线规范。当前授权允许本地开发分支 commit，禁止合并、push 和正式部署；尚待人工验收。

- 状态：APPROVED SPECIFICATION / 本次统一 schema-v2 与 Natural Chime 实现已获明确授权
- 版本：2.1
- 日期：2026-10-02
- 对应 Business Spec：`UNIFIED_BUSINESS_SPEC.md`
- 决策路径：`REUSE_COMPONENTS`
- 修订：保持既有日内 section V4 和风险 section 不变，增加统一顶层 schema 1→2 与 `sections.chime`；不引入第三方运行时依赖。

## 1. 架构决策

采用现有 Vanilla JavaScript 模块复用方案，不引入 UI 框架、第三方状态机、规则引擎或新的运行时依赖。

```text
index.html
   |
   +-- App Shell / Hash Router
   |      +-- #/home  -> Risk Summary + Chime Summary + Intraday Cards
   |      +-- #/risk  -> Full Risk Manager View
   |      +-- #/chime -> Full Natural Chime Settings
   |
   +-- Unified State Coordinator
          +-- Intraday V4 domain model
          +-- Risk Manager domain (unchanged)
          +-- Natural Chime V1 domain
          +-- Preferences
          +-- Backup / unified V1→V2 / nested intraday V3→V4 / Legacy Import / Persistence
```

## 2. 模块边界

### 2.1 必须直接复用

- 日内状态卡：`model.js`、纯函数状态变更、GC/CL/ES 隔离、生命周期和统一渲染路径。
- 风险管理器：`risk-engine.js`、`risk-snapshot.js`、`account-service.js`、`session-service.js`、迁移器。
- 共享主题：现有 `appearance` 读取和应用规则。
- 统一保存：现有 canonical key、单次写入、回读验证、revision 保护、pre-import 快照和多标签页冲突锁。
- 页面交互：现有 `preserveScrollPosition`、折叠/隐藏商品、三路由和导出保护。

风险管理器模块、数据、公式、迁移规则和业务行为不得因本次日内规则升级修改。

### 2.2 本次调整职责

- `src/model.js`：日内 V4 常量、方向/机会许可函数、立即登记、单商品单活动机会、生命周期和 V4 不变量。
- `src/persistence.js`：日内 envelope V3 → V4 的严格校验、确定性迁移、序列化和 Markdown 导出。
- `src/unified-persistence.js`：统一顶层 schema V1→V2 与已冻结的嵌套日内 V3→V4 迁移编排，加入 chime section；风险 section 继续由既有迁移器负责。
- `src/app.js`：新文案、可见顺序、机会按钮、只读入场提示、无位置输入/确认路径和历史兼容显示。
- `dist/app.bundle.js`：由 `npm run build` 从源码重新生成的生产 classic bundle。

## 3. 路由与持久化边界

- 路由规则保持 `#/home`、`#/risk`、`#/chime`、未知 hash 错误页和同一 index 硬刷新。
- 路由切换不得重新初始化业务状态或重复注册全局监听器。
- GC、CL、ES 状态只在日内 section 内按商品 ID 修改；风险 section 不读写日内字段。
- canonical key 仍为 `trading-control-center:v1`；统一顶层 schema 从 1 升为 2。日内 V4 与风险 schema/data/公式保持既有规则；另增 `sections.chime` schema 1。

## 4. V4 数据模型

### 4.1 统一 envelope

统一容器使用 schema 2 顶层结构：

```json
{
  "app": "trading-control-center",
  "schemaVersion": 2,
  "savedAt": 0,
  "timezone": "Asia/Shanghai",
  "revision": 0,
  "sections": {
    "intraday": {
      "app": "intraday-task-cards",
      "schemaVersion": 4,
      "savedAt": 0,
      "state": {
        "schemaVersion": 4,
        "sequence": 0,
        "revision": 0,
        "lastSavedAt": null,
        "cards": {},
        "records": [],
        "migrationAudit": []
      },
      "timezone": "Asia/Shanghai"
    },
    "riskManager": {
      "schemaVersion": 2,
      "selectedAccountId": null,
      "accounts": []
    },
    "chime": {
      "schemaVersion": 1,
      "slots": [
        { "slotId": "slot-1", "enabled": true, "paused": false, "preset": "5", "minutes": 5, "earlySeconds": 30 },
        { "slotId": "slot-2", "enabled": false, "paused": false, "preset": "5", "minutes": 5, "earlySeconds": 30 },
        { "slotId": "slot-3", "enabled": false, "paused": false, "preset": "5", "minutes": 5, "earlySeconds": 30 },
        { "slotId": "slot-4", "enabled": false, "paused": false, "preset": "5", "minutes": 5, "earlySeconds": 30 },
        { "slotId": "slot-5", "enabled": false, "paused": false, "preset": "5", "minutes": 5, "earlySeconds": 30 }
      ],
      "voiceEnabled": true,
      "selectedVoiceURI": "",
      "notifyEnabled": false,
      "legacyImport": { "status": "defaults", "sourceVersion": null }
    }
  },
  "preferences": { "appearance": "system" }
}
```

顶层 schema 2 必须且只能包含已支持的 `intraday`、`riskManager`、`chime` sections 与受支持的 preferences。统一 V1→V2 的 envelope-only 迁移必须对既有 sections/preferences 做值级深比较；新 migration 不得重写账户余额、会话、事件、交易记录或卡片状态。已有嵌套 intraday V3→V4 迁移仍按 §6 独立执行和验证。

### 4.2 V4 卡片与活动机会

每张卡保留 `symbol`、`bias`、`structure3m`、`direction`、`opportunity`、`idleSince` 和兼容字段 `needsStructureReview`；V4 新建卡的 `needsStructureReview` 必须为 `false`。

方向内部键仍为 `long`、`short`、`none`，但 UI 标签为 `做多`、`做空`、`暂无交易方向`。`isDirectionAllowed` 对三种合法偏见均返回三个方向可用；`unjudged` 或 `none` 只阻止机会创建，不反向修改方向。

V4 新机会的内部键和标签为：

| 内部键 | UI 文案 |
| --- | --- |
| `mtf_pb` | `MTF PB` |
| `htf_pb` | `MTF BOF（趋势走弱 1次）` |
| `htf_bof` | `HTF BOF` |

新机会必须满足 `direction !== "none"` 且 `structure3m !== "unjudged"`；满足后三个机会键全部可用。活动机会包含稳定 `id`、`symbol`、`direction`、`type`、`createdAt`、立即写入的 `registeredAt`、偏见/结构登记快照、入场/结束时间、当前注意力阶段和阶段时间线。V4 活动机会的 `zone` 固定为 `null`，不得依赖位置字段。

### 4.3 V4 历史与升级审计

- `records` 是机会快照。V4 新记录在选择机会时立即写入，`zone` 为 `null`。
- V3/V4 旧记录的 legacy type（`pullback`、`range`、`reversal`）和字符串 `zone` 可以继续存在于历史中；它们只按旧标签渲染，不进入 V4 新建机会选项。
- 结果枚举在既有 `invalid`、`canceled`、`direction`、`closed` 之外增加 `rules_upgrade`，显示为“规则升级结束”。该结果仅用于旧活动机会的迁移收尾。
- V4 结束记录不变量：`closed` 必须对应非空 `enteredAt`；`invalid`、`canceled`、`direction` 等普通非持仓结束原因必须对应空 `enteredAt`；仅 `rules_upgrade` 可结束等待/找信号或持仓两类旧活动机会，并且必须带 `migrationReason = "opportunity_taxonomy_upgrade"`。
- `migrationAudit` 为数组；每个 V3 活动机会迁移至少写一条审计项，包含 `fromSchemaVersion`、`toSchemaVersion`、`reason`、`migratedAt`、商品、原 opportunity ID、legacy type、legacy type label、旧 zone（如有）、原阶段、是否已有记录和对应 record ID（如有）。
- 迁移后卡片 `opportunity` 必须为 `null`，方向和其他卡片字段按确定性转换保留；旧历史记录不改名、不删除、不合并。

## 5. 业务模型实现约束

### 5.1 方向与结构

- `changeBias` 只能更新偏见，不因偏见与方向组合而清除方向或结束新机会。
- `changeDirection` 允许所有偏见下的三个方向；若当前有未入场机会，沿用已有确认语义，确认后以 `direction` 结束旧机会并清空当前机会。
- `changeStructure` 可在无机会、未入场机会和持仓时更新结构；不再依据方向/结构机会矩阵失效新机会。
- `isSetupAllowed` 只检查方向不是 `none`、结构不是 `unjudged` 和机会键属于 V4 三种新类型。

### 5.2 机会生命周期

- `chooseSetup` 先检查键和前置条件；同键重复选择返回 `changed: false` 且不 touch。
- 改选其他键时调用既有取消收尾，再创建新活动机会，并在同一纯函数事务中将新快照推入 `records`。
- `setStage`、`markEntered`、`markExited`、`endOpportunity` 只操作当前机会和对应历史快照；不读取或要求 zone。
- 删除记录不自动恢复；`syncRecord` 只有在记录仍存在时更新，保持既有删除不复活语义。

### 5.3 渲染

- `renderCard` 的 controls 顺序必须为 bias、structure、direction、opportunity、stage。
- 方向按钮文案、机会按钮文案与本规范一致；三种偏见的 direction group 都不得因 bias disabled。
- 位置输入、确认按钮、zone draft 监听器和登记提示从 DOM 与事件路径删除。
- 机会区域原位置改为“入场信号”两行同色只读固定提示：第一行为 `均线一侧·BB收窄·气泡攻击&吸收·流动性·信号K`；第二行为 `原方向拒绝+新方向位移（COC）+价格接受（震荡）`。两行继承同一颜色与字体，并以细分隔线区分；桌面三列布局下使用 `white-space: nowrap` 保持严格两行。
- 当前状态摘要仅显示偏见、方向、市场结构和新机会名称，不渲染 zone。
- 历史表可以保留旧位置列；使用 `record.zone ?? '—'`，旧记录显示原 zone，新记录显示 `—`。
- 所有重绘继续经由 `preserveScrollPosition`，不改变折叠、隐藏商品和焦点恢复路径。

## 6. Unified V1 → V2 and nested V3 → V4 deterministic migration

### 6.1 迁移入口

- `persistence.js` 暴露严格的嵌套日内 `migrateEnvelope`/等价迁移函数。
- 日内 `validateEnvelope` 只接受当前 V4；日内迁移函数先验证完整 V3 envelope/state，再生成 V4。统一顶层 validator 只接受 schema 2，统一迁移编排器才接受受支持且完整验证的顶层 schema 1。
- `unified-persistence.js` 只对统一存档 `sections.intraday` 调用 V3 → V4；旧版独立日内备份仍由分类器明确拒绝，不因本次迁移而开放。
- 未知统一顶层版本、未知 section 版本、字段损坏、timeline 不连续、活动记录身份不一致均 fail-closed。

### 6.2 迁移算法

1. 深拷贝原始统一对象；先严格验证统一顶层、风险 section 和日内 V3 envelope。
2. 计算 `migratedAt = max(intraday.savedAt, state/records/opportunity 中所有合法时间戳)`，不使用随机或不稳定时间。
3. 复制所有已结束旧历史记录，保留原 `type`、`zone`、时间线和结果含义。
4. 对每个旧活动机会：
   - 若已有活动历史记录，结束其最后阶段，设置 `endedAt = migratedAt`、`reason = "rules_upgrade"`、`migrationReason = "opportunity_taxonomy_upgrade"`；
   - 若旧机会已经进入持仓，保留 `enteredAt` 及 `wait → position` 阶段；迁移只结束最后一个 `position` 阶段，不改写旧机会类型或关键位置；
   - 若没有历史记录，不伪造普通交易历史，至少写入 `migrationAudit` 完整快照；
   - 清空卡片活动机会、设置 `idleSince = migratedAt`、清除 `needsStructureReview`，保留商品、偏见、结构和方向。
5. 将 intraday state/envelope 版本写为 4，执行 V4 `assertState` 与统一全量校验。
6. 只有全部校验通过后才返回迁移结果；任何错误均不返回部分结果、不写 canonical。

### 6.3 启动与导入事务

- canonical top-level V1 启动时：校验所有 sections/preferences；若适用，先运行既有 nested intraday V3→V4 migration，再运行 envelope-only V1→V2。当前 V4 与 risk/preferences 值必须在 envelope-only 阶段保持深相等；仅新增并验证 chime。全部阶段通过后才允许一次 canonical 写入，写后精确回读。失败时恢复保护并保留原始字符串。
- 当前 unified V2 canonical 永远优先，不重新吸收任何 legacy key，包括旧风险、外观、独立日内或 `natural-chime-settings`。
- local unified V1→V2 只吸收已核实的 legacy chime V1 一次；legacy chime 显式 `version: 2` 或其他未知/损坏/不可表示值走 `UNIFIED_BUSINESS_SPEC.md` §6 的唯一本地只读恢复路径。这里的旧键版本不改变统一 envelope schema 2。显式忽略后采用 chime defaults 且不改 legacy key。
- 无 canonical 的本地 bootstrap 完全忽略 legacy chime key（不读取、不检查、不校验、不吸收），直接使用默认 chime。既有旧风险/外观迁移规则不变。
- 导入 unified V1 文件时，不读取本机 legacy chime key；对文件执行适用的 nested intraday migration、增加 chime defaults、完整验证和影响预览，用户确认后依次执行 pre-import snapshot、expected raw/revision guard、单次 canonical 写入和回读验证。取消或任何失败时当前 canonical、内存和 DOM 不变。
- 导入 unified V2 文件时先严格校验全部 section/preferences，再预览和确认，之后走同一 pre-import snapshot、revision guard、单次写入和回读事务。
- 迁移失败或确认前其他标签页 revision 变化时，当前内存和存储零变化。

### 6.4 Top-level schema V1 → V2 transaction

1. Keep the localStorage key `trading-control-center:v1`; classify the canonical JSON top-level version strictly.
2. Snapshot the exact canonical raw and capture its expected raw/revision before transformation. Validate the V1 envelope, supported nested versions, all existing sections, preferences, and the legacy chime source if this is a local canonical upgrade.
3. If the local V1 canonical has the exact verified legacy chime V1 shape, map it to the frozen five-slot schema without clamping/coercion. If the key is absent, use frozen defaults. Legacy chime `version: 2`, malformed, unknown, or unrepresentable values stop before writes and invoke the one recovery path in Unified Business Spec §6.
4. Construct top-level V2 deterministically: set `schemaVersion = 2`, increment canonical `revision` exactly once, and preserve `savedAt`, `app`, and `timezone`. For a V1 input already containing intraday V4, deep equality is mandatory for `sections.intraday`, `sections.riskManager`, and `preferences`; add only validated `sections.chime`. If an older accepted nested intraday V3 migration is also required, keep it as the separate §6.2 step and verify its result independently before this envelope-only transform.
5. Use the existing revision/raw guard and one canonical write; read back and strictly validate the full V2 envelope. If validation/write/read-back fails, restore the exact prior raw and verify rollback; unverified rollback enters recovery-required and locks writes.
6. The valid V2 canonical is the sole one-time migration marker. No separate receipt key is created. Never delete, rewrite, or clean the legacy chime key.

Unknown top-level or section versions always fail closed. Independent intraday backup formats V1/V2/V3 remain explicitly rejected; this migration does not open that import path. Risk-only backup import continues to replace only `sections.riskManager`.

## 7. 统一存储与风险保持性

- 风险 section 继续使用 `RISK_MANAGER_SCHEMA_VERSION`、现有风险迁移器、公式和严格校验；schema V1→V2 不重写其有效数据。
- Unified V2 full backup contains intraday, riskManager, chime, and preferences. Export/import remains one user-facing JSON artifact.
- 完整提交仍为克隆 → 校验 → revision 加一 → 写 canonical → 回读等值 → 替换内存。
- 风险分项导入只替换 `sections.riskManager`；日内、chime、外观和非风险迁移元数据保持不变。
- GC、CL、ES 只在日内 section 内按卡片 symbol 隔离。
- 多标签页 storage 事件、external conflict 锁、导出可用和风险视图提交路径保持不变。

## 8. 测试与 Verification

至少覆盖：

- 偏多/无偏见/偏空 × 做多/做空/暂无方向全部九种组合；
- 三种已选市场结构 × 做多/做空 × 三种新机会全部可选；方向为空或结构 `unjudged` 时全部禁用；
- 单商品单机会、同机会幂等、切换机会旧记录结束和新记录立即登记；
- 新机会无关键位置即可等待、找信号、入场、平仓；
- Unified top-level V1→V2 migration: chime added once, current intraday/risk/preferences deeply unchanged, legacy key unchanged; nested intraday V3→V4 remains separately deterministic; old opportunity history and migration audit remain correct;
- Legacy chime verified-V1 mapping, explicit-version-2/corrupt/unknown safe mode and exact recovery; unified schema-1/schema-2 import transactions and risk-only import isolation;
- GC、CL、ES 隔离；风险 manager 公式、数据、统一导入导出回归；
- 滚动位置、折叠/隐藏卡、三路由、生产 bundle；
- `npm test`、`npm run build`、`node --check dist/app.bundle.js`、`git diff --check`。

## 9. 完成定义

只有 Business Spec、Architecture Spec、Compatibility Verification Spec 与实现一致，全部测试/构建/本地预览证据新鲜、完整 diff 无无关修改、生产 bundle 已更新且用户完成本地验收后，才可将本次版本标记为 FROZEN。实现已获明确授权；此授权不包含 commit、Push 或部署，须等待后续明确授权。
