# 统一交易控制中心 — Architecture / Technical Spec

- 状态：APPROVED / FROZEN
- 版本：1.3
- 日期：2026-09-10
- 对应 Business Spec：`UNIFIED_BUSINESS_SPEC.md`
- 修订：用户于 2026-09-10 授权在既有纯函数状态模型中实施偏见/方向/结构/机会规则矩阵；不新增依赖，不改当前统一 schema 或字段名；旧独立日内状态卡备份改为拒绝而非迁移。

## 1. 架构决策

采用现有 Vanilla JavaScript 模块复用方案，不引入 UI 框架或第三方路由。

```text
index.html
   |
   +-- App Shell / Hash Router
   |      +-- #/home  -> Risk Summary + Intraday Cards
   |      +-- #/risk  -> Full Risk Manager View
   |
   +-- Unified State Coordinator
          +-- Intraday domain
          +-- Risk Manager domain
          +-- Preferences
          +-- Backup / Legacy Import / Persistence
```

统一宿主仓库：`intraday-task-cards`。

## 2. 模块边界

### 2.1 必须直接复用

- 状态卡：`model.js`、当前 V3 section 校验、状态卡渲染和冲突策略。
- 风险管理器：`risk-engine.js`、`risk-snapshot.js`、`account-service.js`、`session-service.js`、迁移器。
- 共享主题：现有 `appearance` 读取和应用规则。

风险管理器规则不因本次改动修改。状态卡仅修改既有 `model.js` 中的许可矩阵、上游失效与持仓冲突判断；必要的改动限于相应 DOM 呈现、测试与文档。

### 2.2 新增职责

- `router`：解析和切换 `#/home`、`#/risk`，处理未知 route。
- `app-shell`：持有公共页头、视图容器和全局数据入口。
- `unified-model`：组合两个数据域与 preferences，不包含风险公式或状态机规则。
- `unified-persistence`：单键保存、回读验证、revision 和恢复保护。
- `backup-classifier`：识别统一与旧风险格式；检测到旧独立状态卡格式即拒绝。
- `unified-backup`：完整/风险分项导出、完整校验和风险域局部替换。
- `legacy-bootstrap`：首次只读取旧风险与外观键并生成统一存档。
- `risk-view`：由现有完整风险 UI 拆出的可挂载视图控制器。

## 3. 路由设计

- 默认或空 hash：规范化为 `#/home`。
- `#/home`：首页风险摘要、账户快捷操作和 GC/CL/ES 状态卡。
- `#/risk`：完整 Trading Risk Manager。
- 未知 hash：显示轻量错误并提供返回首页，不清空任何数据。
- 路由切换不得重新初始化业务状态或重复注册全局监听器。
- 视图销毁必须释放只属于该视图的监听器和临时 dialog。
- 页面标题、焦点和 `aria-current` 随路由更新。

## 4. 统一数据模型

顶层容器版本独立于两个业务域版本：

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
      "schemaVersion": 3,
      "savedAt": 0,
      "state": {},
      "timezone": "Asia/Shanghai"
    },
    "riskManager": {
      "schemaVersion": 2,
      "selectedAccountId": null,
      "accounts": []
    }
  },
  "preferences": {
    "appearance": "system"
  }
}
```

### 4.1 版本规则

- 顶层 `schemaVersion` 管理组合容器迁移。
- 风险 section 继续由自己的迁移器和验证器负责；日内 section 只接受当前 V3 envelope。
- 用户界面字段名为“市场结构”，以卡片右上角 `3M` 徽标说明周期；不重命名 `structure3m` 字段。`unjudged` 是当前统一数据可保留的内部安全态，但渲染层仅枚举多头、震荡、空头；不再进行独立日内数据迁移。
- 未知、过低或更高版本不得猜测迁移。

### 4.2 规范化规则

- 导入完成后的内存对象必须是当前版本。
- 风险数据只允许确定性迁移；不得根据账户名、文件名、金额或时间猜测缺失业务字段。日内旧数据一律拒绝。
- 金额保持现有 Number/美分比较规则，不在合并中切换数据类型。
- 不跨 section 比较或要求 ID 唯一；每个 section 内必须唯一。

## 5. 存储设计

### 5.1 键

- 新 canonical key：`trading-control-center:v1`。
- 回退快照 key：`trading-control-center:v1:pre-import`。
- 旧风险 key：`trading-risk-manager:v1`。
- 旧外观 key：`trading-risk-manager:appearance`。

### 5.2 写入合同

每次业务修改遵循：

1. 在克隆状态上执行业务操作；
2. 校验被修改 section；
3. 校验完整统一 envelope；
4. revision 加一并序列化；
5. 单次写入 canonical key；
6. 立即回读并验证原始字符串一致；
7. 成功后才替换当前内存状态。

写入失败不得修改当前内存状态；如交互必须先更新内存才能渲染，则需保留上一个已持久化快照并进入明确的未保存状态，不得声明成功。

### 5.3 冲突合同

- 监听 canonical key 的 `storage` 事件。
- 其他标签页写入不同 revision 后，当前标签进入只读锁。
- 锁定时允许完整和分项导出；禁止修改、导入、清空和确认已经打开的危险操作。

## 6. 首次兼容恢复

仅当 canonical key 不存在时执行：

1. 读取旧风险与外观键，保留原始字符串；
2. 风险执行 V1 → V2；外观规范化；
3. 创建合法空白日内 section，并对两个 section 完成严格校验；
4. 组合并校验统一 envelope；
5. 写入 canonical key 并回读；
6. 旧风险与外观键保持原样。

异常策略：

- 旧风险键不存在：创建合法空白统一状态。
- 旧风险键有效：迁移风险域；日内域使用明确的合法空白状态。
- 旧风险键损坏：停止自动迁移，保留原始内容并进入恢复保护。
- canonical key 已存在：它始终优先，不自动合并旧数据。
- 旧独立日内状态卡键不读取、不迁移，也不作为恢复候选。

## 7. 备份识别与导入

### 7.1 分类器

分类顺序：

1. `app === "trading-control-center"` 且具有 `sections`：统一格式；
2. `app === "intraday-task-cards"` 且具有状态卡 envelope：立即明确拒绝；
3. 无 `app`，且有 `schemaVersion`、`accounts`、`selectedAccountId`：旧风险格式。

若零类或多类匹配，拒绝导入；不得依赖文件名。

### 7.2 导入事务

1. 检查文件类型和 8 MB 上限；
2. 解析但不写入；
3. 分类；
4. 统一格式直接校验；风险格式只迁移风险 section；旧日内格式终止；
5. 严格校验相关 section；
6. 将其合并到当前完整 envelope 的克隆；
7. 全量校验合并结果；
8. 显示影响范围、数据数量和风险版本迁移预览；
9. 用户确认；
10. 先将当前 canonical 原始内容写入 pre-import key 并回读；
11. 单次替换 canonical key 并回读；
12. 更新内存和界面。

完整导入替换两个 section 与 preferences；风险分项导入只替换风险 section；不提供日内分项导入。

## 8. 验证强化

风险 section 验证必须在现有基础上新增：

- account、currentSession、previousSession、balanceEvent ID 的域内唯一性；
- ISO 时间戳合法性；
- 余额事件链 `previousBalance` 与前一余额一致；
- `delta === newBalance - previousBalance`，按现有金额容差规则比较；
- selectedAccountId 指向唯一现有账户；
- snapshot 版本字段组合完整；
- 不允许 `NaN`、`Infinity` 或隐式字符串金额。

状态卡继续以现有 `assertState` 为最终业务不变量校验：非持仓方向必须与偏见兼容；非持仓机会还必须与方向/结构矩阵兼容；持仓可暂时保留冲突并由 UI 警示。

## 9. 构建与命名隔离

- 继续提供无需运行时网络和 CDN 的生产 bundle。
- 构建必须检测重复顶层符号，不能仅依赖后出现的声明覆盖前声明。
- 所有新增模块使用显式 import/export；如继续输出 classic bundle，构建器必须生成确定性顺序并在测试中加载完整产物。
- 生产 `index.html` 不引用旧仓库的远程脚本或样式。

## 10. 发布兼容验证

1. 先冻结两个当前已验收版本的 commit 与测试结果；
2. 在统一宿主完成实现和全部本地验证；
3. 用户查看初版 UI；
4. 用户明确批准后才发布统一站点；
5. 线上完成旧风险键兼容恢复和当前统一备份演练；
6. 旧风险站点切换为只读说明和统一站点跳转；
7. 至少完成一个真实交易日观察及一次完整恢复演练后，再决定是否归档旧仓库。

旧风险键在观察期内不得删除；旧独立日内文件已由用户在本地清理，应用不再读取或迁移它们。

## 11. 安全与隐私

- 不提交真实账户数据、备份、浏览器存储或截图中的敏感值。
- 测试仓库只使用脱敏合成夹具。
- 错误信息可报告字段路径，不应回显整个用户备份。
- 不使用远程 CDN，避免断网或供应链故障阻断工具。

## 12. 完成定义

只有以下条件同时满足才可标记统一版 FROZEN：

- Business/Architecture/Verification 三份规范一致；
- 当前全量回归测试全部通过，并在报告中记录实际数量；
- 新兼容矩阵全部通过；
- 本地浏览器与公开 Pages 均验证；
- 当前统一备份与旧风险键兼容性已验证；旧独立日内备份已验证为拒绝且零副作用；
- 已知重大问题为零；
- 发布 commit、公开 URL 和回退基线均明确。
