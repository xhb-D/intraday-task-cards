# Multi-Trade V6 M1 Implementation Report

## 基线与授权

- Branch：`codex/multi-trade-v6-m1-model-migration`。
- Base：`c4b97243cee5fd23bbea4ecb83a0568f22b25a78`。
- 开始前 git status / HEAD / fetch origin / origin/main 已核对；远端main仍为指定基线，创建独立分支。仅本地commit，不push/merge/deploy。
- 已接受审计报告全文与上一轮版本核对，内容不改；开始及提交前SHA-256均为 `a9fc4bc8f972bef1e70cff0efe9b432cc14d68720b1de73fec31c5a02c659d2b`，原未跟踪文件一并纳入本次commit。
- `.DS_Store` 为开始前已有未跟踪文件，保留且不纳入commit。
- 本报告与实现一起提交；新commit完整SHA由最终交付回复及 `git rev-parse HEAD`提供，避免文档自引用。

## 新增文件

1. `src/intraday-v6/model.js`：V6创建、按ID生命周期/手工捕获、单笔/批量退出、普通删除、候选先验事务。
2. `src/intraday-v6/queries.js`：active Opportunity/Trades、effectiveDirection、recordLifecycle纯查询。
3. `src/intraday-v6/validation.js`：V6单源/集合/时间/事件/exitCapture/JSON validator，复用冻结V5单record验证。
4. `src/intraday-v6/migration.js`：纯V5→V6，显式migratedAt、恢复审计、冲突阻断、旧字段保留。
5. `test/multi-trade-v6-model.test.js`。
6. `test/multi-trade-v6-migration.test.js`。
7. `test/fixtures/intraday-v6.js`：新增fixture helper，未改旧fixtures。
8. `docs/MULTI_TRADE_V6_M1_SPEC.md`：本轮业务及技术契约、API与边界。
9. 本报告。
10. 已接受的 `docs/MULTI_TRADE_ARCHITECTURE_AUDIT_V1.md`，内容原样。

没有修改任何基线tracked文件。V6未被 `app.js`、startup、persistence、Unified、production build或Exit Research入口import。旧model、Risk、Chime、HTML/CSS、Research Store、Tradovate parser/reconstruction/reconciliation、Step4A/B和旧tests均不修改。未引入新依赖或复制数学引擎。

## 实际实现

- V6 workspace仍七字段，cards精确六字段并拒绝opportunity/activeTrades。records保存所有pending/active/ended生命周期；无tradeId或有效stop/management副本。
- `activeOpportunityForSymbol` 按symbol/未入场/未结束查询；`activeTradesForSymbol` 按enteredAt→registeredAt→id排序（确定性字符串比较）；effectiveDirection优先持仓、其次pending、最后card。
- chooseSetup在持仓时继承active方向；markEntered保留原record对象/ID，只改变阶段与enteredAt，下一笔可直接登记。changeDirection在holding或pending期间都锁定；confirmed参数不能绕过。Bias/Structure仅更新card，新注册取新snapshot，旧交易不变。
- 单笔/取消/阶段/事件API按ID。事件通过临时detached V5 view复用冻结writer/reducer；该view不存储、不作为V6事实源。每笔Research Capture仍为eventSequence/manualEvents，保留全部原事件、修正和撤销引用。
- 所有变更先验证输入和完整candidate，再检查调用方可写性并执行确定性内部变更。候选失败、未确认、no-op不改state/revision；已存在record对象保留，其他record不修改。无localStorage、网络或随机数。
- `markTradeExited`只关闭目标active Trade，STOP_EXIT/OTHER_EXIT/UNKNOWN，groupId=null；MANUAL_FLATTEN不能进入单笔API。
- `markAllTradesExited`捕获调用时目标ID，先验证所有closeTime≥最后stage.start、每个record全部event.recordedAt，再同一time关闭所有目标；revision只+1。groupId由下一revision确定生成，遇已使用ID则确定性加后缀；同批共享、不同批唯一。pending Opportunity保持wait/signal。
- `exitCapture`只含kind/groupId，不新增退出时间；确认时间只在endedAt。active、未入场历史、rules_upgrade为null，正常closed必有exitCapture。
- 未结束record不能普通删除；已结束历史可删；不实现hide系统。

## Migration 实证

纯接口：`migrateV5ToV6(v5State, { migratedAt }) → { state, migratedAt, audits }`。

| 场景 | 实际结果 |
|---|---|
| 正常V5 card+record一致 | 保留一份原record加exitCapture，cards移除opportunity |
| V5 position / wait / signal | 正确成为derived activeTrade或activeOpportunity，原ID/时间/阶段不变 |
| Active Record Missing | position/wait/signal全部恢复，通过原V5validator后从recordSnapshot取完整原字段；追加 `ACTIVE_RECORD_RECOVERED_FROM_V5_CARD` |
| 多品种missing | GC/CL/ES固定顺序恢复，sequence/revision不变，不重新编号 |
| 双副本冲突 | `ACTIVE_RECORD_CONFLICT_IN_V5` / status=BLOCKED；抛出的错误无state/candidate，原输入不变 |
| 非法V5 | `INVALID_V5_STATE`，不从另一副本“修好” |
| missing migratedAt / 非法时间 | `MIGRATED_AT_REQUIRED`，不隐式读当前时间 |
| 正常closed历史 | UNKNOWN/null，保留完整时间/事件；不猜Stop/Flatten |
| invalid/canceled/direction历史 | exitCapture=null，原reason保持 |
| V3→V4→V5历史进入此纯接口 | 保留原rules_upgrade/migrationReason/zone/全部旧migrationAudit，未改旧迁移链 |
| JSON roundtrip / reload | assertV6State通过；A+B active、C wait仅从records完整恢复 |
| 相同input+migratedAt | 输出deepEqual；Date.now替换成抛错函数时仍通过；deepfreeze原输入仍可迁移 |
| 非空zoneDraft | `V5_ZONE_DRAFT_REQUIRES_REVIEW`阻断该fixture；不丢弃可能的用户内容；空draft不进入records |

迁移不增加通用summary audit，不改变sequence/revision/lastSavedAt或业务时间；返回state与audit列表都与输入detach。M1未写任何生产localStorage，也未用真实用户备份进行V6写入。测试为synthetic/已有冻结fixture，不能声称真实备份迁移验收已完成。

## 测试与 Verification

新增**94项具名测试**，另有1个新增fixture模块被Node自动计为独立测试单元；npm test总数增加95。原655项无删除、skip、修改或弱化。

| 验证 | 结果 |
|---|---|
| 两个新test文件定向执行 | 94/94 PASS |
| `npm test` | **750/750 PASS**；0 fail、0 cancelled、0 skipped、0 todo |
| `npm run build` | PASS；生产模块集未变 |
| `node --check dist/app.bundle.js` | PASS |
| `git diff --check`（包括最终staged新增文件） | PASS |
| baseline bundle与build结果 `cmp` | 完全逐字节一致 |
| production tracked-file diff vs base | 空（所有M1文件均新增） |
| 审计文档开始/结束SHA对照 | 一致 |

生产bundle开始、git baseline副本及最终build的SHA-256均为：

`7372cfb300effc6d5283683b610675900fdd87f133e756203d2cd26176ac2a6c`

验证日志保存在仓库外：`/private/tmp/multi-trade-v6-m1-focused.log`、`/private/tmp/multi-trade-v6-m1-test.log`、`/private/tmp/multi-trade-v6-m1-build.log`。基线bundle比较副本：`/private/tmp/multi-trade-v6-m1-baseline.bundle.js`。

具名测试覆盖用户A–U：PB生命周期与对象身份；A持仓+新wait/入场B；B Stop只结束B；reload保留A；再入C与一次flatten；逐笔stop修正/BOF转换撤销；A+B+Cwait无card对象JSON恢复；V5 position/wait/signal/missing/conflict；active禁止删除；B时间非法整批不变；pending C不结束；方向锁；新旧背景snapshot；非法stop/event时间原子性。

额外验证：同单stage时间倒退、single exit误用MANUAL_FLATTEN、pending/ended事件目标拒绝、确认显式true、group确定性/不同批次/导入碰撞、外品种隔离、counter溢出/不可写对象提交前拒绝、validator拒绝双写truth/foreign events/重复ID/多pending/反向集合/exitCapture时间副本/JSON有损数据/accessor、候选变更失败不修复输入、legacy与production import/bundle隔离。

## 限制与人审事项

- 本轮不接生产UI，未做新UI浏览器验收；未实现任何Step2–5A算法改变、broker执行对象、Stop归属、共享Fill定价、matching、Store V2、Step5B或行情POC。
- 发现一个额外兼容边界：旧V5 validator可接受部分倒退的阶段/入场时间。新增synthetic fixture证明这一点。V6严格时间验证将此类输入作为 `V6_MIGRATION_CANDIDATE_INVALID` 阻断，保留原件/时间而不修复。后续真实迁移若遇到此类数据，需要人工处置；本轮没有证据证明真实用户数据包含此问题。
- 合法V5附加但不能无损JSON保存的元数据、第二truth字段或非空draft也不会被静默清理，会阻断并报告。未发现必须扩大M1代码范围的新问题；上述fail-closed兼容政策应在本次人审中确认，生产接入仍需另行授权。
- 已接受的审计中missing active history决策已由本轮明确批准：恢复并正常显示，不hidden。相关三个恢复用例全部PASS，不再等待这个旧决策。
- M1实现完成，不自动标记FROZEN，不开展M2，不push，不merge，不deploy。

M1 IMPLEMENTATION COMPLETE

NO PRODUCTION WIRING

NO DEPLOYMENT

WAITING FOR HUMAN REVIEW
