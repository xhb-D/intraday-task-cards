# 统一交易控制中心 — Architecture / Technical Spec

- 状态：APPROVED / IMPLEMENTATION-AUTHORIZED
- 版本：2.0
- 日期：2026-09-28
- 对应 Business Spec：`UNIFIED_BUSINESS_SPEC.md`
- 决策路径：`REUSE_COMPONENTS`
- 修订：在现有 Vanilla JavaScript、纯函数状态模型、统一存档、冲突保护和风险管理器边界内，将日内 section 从 V3 升级到 V4；不引入第三方运行时依赖。

## 1. 架构决策

采用现有 Vanilla JavaScript 模块复用方案，不引入 UI 框架、第三方状态机、规则引擎或新的运行时依赖。

```text
index.html
   |
   +-- App Shell / Hash Router
   |      +-- #/home  -> Risk Summary + Intraday Cards
   |      +-- #/risk  -> Full Risk Manager View
   |
   +-- Unified State Coordinator
          +-- Intraday V4 domain model
          +-- Risk Manager domain (unchanged)
          +-- Preferences
          +-- Backup / V3 migration / Legacy Import / Persistence
```

## 2. 模块边界

### 2.1 必须直接复用

- 日内状态卡：`model.js`、纯函数状态变更、GC/CL/ES 隔离、生命周期和统一渲染路径。
- 风险管理器：`risk-engine.js`、`risk-snapshot.js`、`account-service.js`、`session-service.js`、迁移器。
- 共享主题：现有 `appearance` 读取和应用规则。
- 统一保存：现有 canonical key、单次写入、回读验证、revision 保护、pre-import 快照和多标签页冲突锁。
- 页面交互：现有 `preserveScrollPosition`、折叠/隐藏商品、双路由和导出保护。

风险管理器模块、数据、公式、迁移规则和业务行为不得因本次日内规则升级修改。

### 2.2 本次调整职责

- `src/model.js`：日内 V4 常量、方向/机会许可函数、立即登记、单商品单活动机会、生命周期和 V4 不变量。
- `src/persistence.js`：日内 envelope V3 → V4 的严格校验、确定性迁移、序列化和 Markdown 导出。
- `src/unified-persistence.js`：统一存档内日内 section 的迁移编排；风险 section 继续由既有迁移器负责。
- `src/app.js`：新文案、可见顺序、机会按钮、只读入场提示、无位置输入/确认路径和历史兼容显示。
- `dist/app.bundle.js`：由 `npm run build` 从源码重新生成的生产 classic bundle。

## 3. 路由与持久化边界

- 路由规则保持 `#/home`、`#/risk`、未知 hash 错误页和同一 index 硬刷新。
- 路由切换不得重新初始化业务状态或重复注册全局监听器。
- GC、CL、ES 状态只在日内 section 内按商品 ID 修改；风险 section 不读写日内字段。
- canonical key 仍为 `trading-control-center:v1`；统一顶层 schema 仍为 1。本次只升级嵌套日内 envelope/state 版本。

## 4. V4 数据模型

### 4.1 统一 envelope

统一容器的顶层结构保持：

```json
{
  "app": "trading-control-center",
  "schemaVersion": 1,
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
    }
  },
  "preferences": { "appearance": "system" }
}
```

### 4.2 V4 卡片与活动机会

每张卡保留 `symbol`、`bias`、`structure3m`、`direction`、`opportunity`、`idleSince` 和兼容字段 `needsStructureReview`；V4 新建卡的 `needsStructureReview` 必须为 `false`。

方向内部键仍为 `long`、`short`、`none`，但 UI 标签为 `做多`、`做空`、`暂无交易方向`。`isDirectionAllowed` 对三种合法偏见均返回三个方向可用；`unjudged` 或 `none` 只阻止机会创建，不反向修改方向。

V4 新机会的内部键和标签为：

| 内部键 | UI 文案 |
| --- | --- |
| `mtf_pb` | `MTF PB` |
| `htf_pb` | `HTF PB` |
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
- 机会区域原位置改为只读固定提示：`入场信号：原方向拒绝+新方向位移（COC）+价格接受（震荡）`。
- 当前状态摘要仅显示偏见、方向、市场结构和新机会名称，不渲染 zone。
- 历史表可以保留旧位置列；使用 `record.zone ?? '—'`，旧记录显示原 zone，新记录显示 `—`。
- 所有重绘继续经由 `preserveScrollPosition`，不改变折叠、隐藏商品和焦点恢复路径。

## 6. V3 → V4 确定性迁移

### 6.1 迁移入口

- `persistence.js` 暴露严格的 `migrateEnvelope`/等价迁移函数。
- `validateEnvelope` 只接受当前 V4；迁移函数先验证完整 V3 envelope/state，再生成 V4。
- `unified-persistence.js` 只对统一存档 `sections.intraday` 调用 V3 → V4；旧版独立日内备份仍由分类器明确拒绝，不因本次迁移而开放。
- V1、V2、未知未来版本、字段损坏、timeline 不连续、活动记录身份不一致均 fail-closed。

### 6.2 迁移算法

1. 深拷贝原始统一对象；先严格验证统一顶层、风险 section 和日内 V3 envelope。
2. 计算 `migratedAt = max(intraday.savedAt, state/records/opportunity 中所有合法时间戳)`，不使用随机或不稳定时间。
3. 复制所有已结束旧历史记录，保留原 `type`、`zone`、时间线和结果含义。
4. 对每个旧活动机会：
   - 若已有活动历史记录，结束其最后阶段，设置 `endedAt = migratedAt`、`reason = "rules_upgrade"`、`migrationReason = "opportunity_taxonomy_upgrade"`；
   - 若旧机会已经进入持仓，保留 `enteredAt` 及 `wait → position` 阶段；迁移只结束最后一个 `position` 阶段，不改写旧机会类型或关键位置；
   - 若没有历史记录，不伪造普通交易历史，至少写入 `migrationAudit` 完整快照；
   - 清空卡片活动机会、设置 `idleSince = migratedAt`、清除 `needsStructureReview`，保留商品、偏见、结构和方向。
5. 将 state/envelope 版本写为 4，执行 V4 `assertState` 与统一全量校验。
6. 只有全部校验通过后才返回迁移结果；任何错误均不返回部分结果、不写 canonical。

### 6.3 启动与导入事务

- canonical V3 统一存档启动时：先在内存确定性迁移；迁移结果通过全量校验后才允许一次 canonical 写入。写入失败继续恢复保护/未保存提示，原始字符串不得被空白覆盖。
- 当前统一 V4 仍 canonical 优先，不再吸收旧风险键。
- 导入 V3 统一备份时：解析、分类、V3 迁移、风险/统一校验、影响预览、用户确认、pre-import 快照、单次 canonical 写入、回读验证，顺序不可改变。
- 迁移失败或确认前其他标签页 revision 变化时，当前内存和存储零变化。

## 7. 统一存储与风险保持性

- 风险 section 继续使用 `RISK_MANAGER_SCHEMA_VERSION`、现有风险迁移器、公式和严格校验。
- 完整提交仍为克隆 → 校验 → revision 加一 → 写 canonical → 回读等值 → 替换内存。
- 风险分项导入只替换 `sections.riskManager`；日内 section、外观和迁移审计保持不变。
- GC、CL、ES 只在日内 section 内按卡片 symbol 隔离。
- 多标签页 storage 事件、external conflict 锁、导出可用和风险视图提交路径保持不变。

## 8. 测试与 Verification

至少覆盖：

- 偏多/无偏见/偏空 × 做多/做空/暂无方向全部九种组合；
- 三种已选市场结构 × 做多/做空 × 三种新机会全部可选；方向为空或结构 `unjudged` 时全部禁用；
- 单商品单机会、同机会幂等、切换机会旧记录结束和新记录立即登记；
- 新机会无关键位置即可等待、找信号、入场、平仓；
- V3 统一存档迁移、旧历史名称/zone 保持、旧活动机会确定性结束和 audit；损坏/未知版本 fail-closed；
- GC、CL、ES 隔离；风险 manager 公式、数据、统一导入导出回归；
- 滚动位置、折叠/隐藏卡、双路由、生产 bundle；
- `npm test`、`npm run build`、`node --check dist/app.bundle.js`、`git diff --check`。

## 9. 完成定义

只有 Business Spec、Architecture Spec、Verification Spec 与实现一致，全部测试/构建/本地预览证据新鲜、完整 diff 无无关修改、生产 bundle 已更新且用户完成本地验收后，才可将本次版本标记为 FROZEN。未获明确授权前不得 commit 或 Push。
