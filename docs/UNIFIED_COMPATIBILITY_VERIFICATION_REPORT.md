# 统一交易控制中心 — 本地兼容验证报告（草稿）

- 日期：2026-09-08
- 范围：本地源码、脱敏夹具和自动化测试
- 发布结论：**不允许发布**。本报告不构成 Pages、旧站点或真实备份的线上验收。
- 规范修订：用户于 2026-09-08 明确授权将当前市场结构展示恢复为 3M；仅更新展示、辅助文本和文档，`structure3m` 与既有备份未迁移、未改名。

## 本次实现

- 风险域验证现在检查账户配置、非空且全局唯一的账户/时段/事件 ID、V1/V2 快照字段、`previousSession`、金额、时间戳、事件链和 delta。
- 导入在解析前执行 8 MB 限制；分项导入和完整导入均为先验证、后提交。
- canonical 写入失败、pre-import 快照失败、写后回读不一致和确认期间 revision 变化都有独立错误码；写后回读不一致会使页面停止继续编辑和导入，导出仍可用。
- 首屏外观 bootstrap 优先安全读取 canonical 的 `preferences.appearance`；仅当 canonical 缺失或损坏时回退只读旧外观键，且从不写旧键。
- 用户可见的当前市场结构统一为 3M；右上角标签、JSON 兼容字段 `structure3m` 与既有数据保持不变。
- 夹具位于 `test/fixtures/compatibility/`，均为合成数据；manifest 记录版本、section、摘要与 SHA-256。
- 隐私清理：风险看板测试账户改为明确演示值；全仓未再发现 LFF/LFE 加长数字、真实备份文件名或包含账户/余额的 QA 截图。

## 自动化证据

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 通过 |
| `node --check dist/app.bundle.js` | 通过 |
| `node --test test/appearance.test.js test/build-symbols.test.js test/compatibility-matrix.test.js` | 48/48 通过 |
| `npm test` | 216/216 通过 |

原状态卡和风险逻辑回归仍由全量 `npm test` 覆盖；其中风险历史套件为 106 个业务回归断言，状态卡原有回归门槛保持在该全量集合中。

## C01–C38 矩阵

| 编号 | 自动化结果 | 证据 |
| --- | --- | --- |
| C01 | PASS | 双旧键迁移、首次 canonical 写入、旧键字节不变 |
| C02 | PASS | 仅状态卡键，不虚构账户 |
| C03 | PASS | 仅风险键，生成 GC/CL/ES 空白工作区 |
| C04 | PASS | canonical 优先 |
| C05 | PASS | 较新旧状态卡仅提示，不覆盖 |
| C06 | PASS | 状态卡 V1 → V3 和结构审查 |
| C07 | PASS | V2 `near` → `wait` 与阶段合并 |
| C08 | PASS | V3 往返 |
| C09 | PASS | 风险 V1 → V2、冻结快照、null hard loss |
| C10 | PASS | 风险 V2 往返 |
| C11 | PASS | 统一 V1 两域与外观恢复 |
| C12 | PASS | 仅替换 intraday |
| C13 | PASS | 仅替换 riskManager |
| C14 | PASS | 状态卡分项导出可验证 |
| C15 | PASS | 风险分项导出由复制入仓库的旧 `backup-service.validateImport` 验证 |
| C16 | PASS | 损坏 JSON 零变化 |
| C17 | PASS | 未知顶层版本拒绝 |
| C18 | PASS | 未知 section 版本拒绝 |
| C19 | PASS | 零匹配格式拒绝 |
| C20 | PASS | 歧义格式拒绝 |
| C21 | PASS | 重复 ID 与字段路径 |
| C22 | PASS | 余额链断裂拒绝 |
| C23 | PASS | delta 错误拒绝 |
| C24 | PASS | 非法时间戳拒绝 |
| C25 | PASS | 活动机会/记录身份不一致拒绝 |
| C26 | PASS | 8 MB 解析前拒绝 |
| C27 | PASS | canonical 写失败保留旧值 |
| C28 | PASS | 回读不一致安全停止 |
| C29 | PASS | pre-import 快照失败不写 canonical |
| C30 | PASS | expected raw/revision guard 阻止覆盖 |
| C31 | PASS | 重复导入幂等 |
| C32 | PASS | 多账户、历史、选择和风险结论 |
| C33 | PASS | 小数金额边界 |
| C34 | PARTIAL | 无 storage 降级与 JSON 解析已自动化；Safari `file://` 实机未完成 |
| C35 | PARTIAL | 隔离 storage 与 JSON 导入已自动化；双 localhost 端口实机未完成 |
| C36 | PASS（本地实机） | `#/risk` 硬刷新加载同一 index，无 404 |
| C37 | PASS（本地实机） | 浏览器实测 home → risk → back home → forward risk |
| C38 | PENDING | 只验证目标静态页面不写旧键；旧站点/Pages 切换必须在发布授权后验证 |

## 已完成的只读实机验证（Supervisor 记录）

- 本地地址：`http://127.0.0.1:4174/`。
- `#/risk` 硬刷新成功；风险页返回首页成功；浏览器历史实测 home → risk → back home → forward risk。
- 风险页显示选中账户、完整 20 项诊断和 1 条余额历史；EOD 账户不显示 Floor。
- 首页显示 GC/CL/ES 三卡，字段标题为“当前 3M 市场结构”。
- 真实备份仅作只读复核：状态卡 schema 2 一份、风险 schema 1 两份、风险 schema 2 一份，均完成 normalize/validate；重复导入 section 稳定；风险分项均通过旧 validator。未将账户名、余额或原始备份复制进仓库。

## 未完成的发布前证据

- C34 Safari `file://` 实机与 C35 双 localhost 端口实机仍未完成。
- 未部署或修改旧站点；没有 Pages commit、公开 URL、缓存验证或 C38 线上行为证据。

## 回退与发布门槛

- 未创建 commit；回退应基于用户确认的后续 commit 或当前工作区 diff，不能以本草稿代替版本基线。
- 在真实备份只读导入、本地浏览器四方对账、公开 Pages 与旧站点只读跳转全部通过前，保持发布阻断。
