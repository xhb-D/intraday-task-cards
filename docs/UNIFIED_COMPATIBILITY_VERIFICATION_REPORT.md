# 统一交易控制中心 — 本地兼容验证报告

- 日期：2026-09-28
- 状态：LOCAL VERIFICATION PASS / USER ACCEPTANCE PENDING
- 范围：本地源码、合成 V3/V4 夹具、自动化测试、生产 bundle 和 `127.0.0.1` 预览
- 发布结论：不执行发布、commit 或 Push；本报告等待用户本地验收，不标记 FROZEN。
- 规范版本：Business / Architecture / Verification Spec 2.0

## 本次实现

- 日内状态从 V3 升级为 V4；偏见与方向完全解耦，方向文案为“做多 / 做空 / 暂无交易方向”。
- 当前机会改为 `MTF PB` / `HTF PB` / `HTF BOF`；选择即登记，同一商品单活动机会，切换按取消语义结束旧记录并创建新记录。
- 删除关键位置输入、确认按钮及相关事件路径；改为固定只读入场提示。新记录 `zone = null`，历史界面对新记录显示 `—`。
- 统一存档内 V3 日内 section 采用严格、确定性 V3 → V4 迁移；旧历史 type/zone 保留，旧活动机会以 `rules_upgrade` 结束并写入 `migrationAudit`；没有旧历史记录的活动机会只写审计，不伪造交易记录。
- 新增真实 V3 持仓夹具：活动卡片与活动 record 均包含完整 `wait → position` 时间线；迁移后保留 `enteredAt`、旧 type/zone 和阶段历史，仅结束末阶段并记录 `rules_upgrade` 与升级审计。
- 风险管理器、GC/CL/ES 隔离、统一存档、pre-import 快照、回读校验、多标签页冲突锁、外观和滚动位置逻辑保持原边界。
- 已重新生成生产文件 `dist/app.bundle.js`。

## 自动化证据

| 命令 | 结果 |
| --- | --- |
| `npm test` | 218/218 通过 |
| `npm run build` | 通过 |
| `node --check dist/app.bundle.js` | 通过 |
| `git diff --check` | 通过 |

### 核心验收覆盖

| 范围 | 结果 |
| --- | --- |
| 三种偏见 × 三种方向 | PASS；九种组合均可选 |
| 已选结构 × 做多/做空 × 三种新机会 | PASS；全部组合可登记 |
| 单商品单机会、重复选择、切换机会 | PASS；幂等、旧记录取消、新记录立即登记 |
| 无关键位置等待/找信号/入场/平仓 | PASS；新记录 `zone = null` |
| V3 统一存档迁移 | PASS；等待和持仓活动机会均确定性结束，V3 独立备份仍 fail-closed |
| 旧历史及旧活动机会 | PASS；type/zone 保持，规则升级结束和审计可验证 |
| 损坏/未知版本、身份/时间线错误 | PASS；不覆盖原始存档 |
| GC、CL、ES 隔离 | PASS |
| 风险管理器公式、数据和风险分项导入导出 | PASS；风险回归套件通过 |
| 统一导入导出、pre-import、回读和 revision 冲突 | PASS |
| 滚动位置、折叠/隐藏商品和双路由 | PASS；既有自动化回归通过 |
| 生产 bundle 与资源版本 | PASS；无网络依赖，资源版本统一为 `unified-20260928-1` |

## 本地预览

- 地址：[http://127.0.0.1:4174/](http://127.0.0.1:4174/)
- 已在 Codex In-app Browser 检查 `#/home` 和 `#/risk`：首页显示 V4 迁移提示、三卡新按钮/标题/只读入场提示；风险页可打开并显示风险数据；返回入口与路由存在。
- 当前仅提供本地验收；未进行 Safari `file://` 实机、双端口隔离或公开站点验证。

## 变更边界

- 已检查完整工作区 diff 和空白错误；风险管理器源码未改动。
- 未创建 commit，未 Push GitHub；当前修改全部保留在工作区，等待用户验收。
