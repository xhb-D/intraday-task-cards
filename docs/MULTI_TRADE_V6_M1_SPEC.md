# Multi-Trade V6 M1 Spec

基线：`c4b97243cee5fd23bbea4ecb83a0568f22b25a78`。人工已接受架构审计及本轮 M1 实现指令；本文将该授权落实为可测试的业务/技术契约。完成后待人工审核，不自行宣称 FROZEN。

## Business Spec

- B′：所有 Opportunity / Trade 生命周期仅存于 `records[]`，沿用 `id=opportunityId`。同品种 N 笔同方向 active Trade，最多一个未入场 active Opportunity。
- cards 仅含 symbol/bias/structure3m/needsStructureReview/direction/idleSince。方向由 active Trades → pending Opportunity → card 偏好派生；有任何未结束记录时普通 changeDirection 锁定，confirmed 不能绕过。
- 创建机会冻结原始 Setup、方向、注册时间和 Bias/Structure snapshot。已有持仓仍可创建同向机会，入场修改同一记录而不另建业务对象。
- Initial Stop 与 BOF→PB 完整沿用 V5 append-only 事件语义，写操作按 ID，逐记录 reducer 为有效值的唯一来源。禁止持久化第二份 stop/management/tradeId/活跃列表。
- Single Exit 只接受 active Trade、STOP_EXIT/OTHER_EXIT/UNKNOWN；reason=closed，exitCapture={kind,groupId:null}。
- Manual Flatten 捕获调用时同 symbol 的 active Trade ID；全部目标先验后原子关闭，同 endedAt、共享 MANUAL_FLATTEN groupId，revision 只+1；不关 pending Opportunity。
- groupId 由工作区递增操作 revision 派生，确定且不使用随机或第二份时间；不同关闭批次不能共用同一个 groupId。若导入数据恰有相同候选 ID，确定性跳过已使用 ID。
- 所有关闭时间必须 ≥ 最后 stage.start、全部 manualEvent.recordedAt；stage 转换也不得时间倒退。非法操作抛结构化错误或返回 changed:false，state/revision完全不变。
- deleteRecord 禁止删除任何未结束记录；只允许删除已结束历史。不增加 hide 系统。
- 取消/失效仅作用未入场目标；更换 pending Setup 保持旧版取消并登记新机会语义，但不能关闭任何持仓。普通 changeDirection 不再隐式取消 pending。

## Architecture / Schema

- 新模块 `src/intraday-v6/`；不被生产入口/build modules import。生产仍是 Intraday V5、Unified V2；本轮不改变任何线上 schema 或页面行为。
- V6 顶层精确七字段：schemaVersion=6, sequence, revision, lastSavedAt, cards, records, migrationAudit；cards 精确三个品种，每 card 精确六字段。
- Record：原 V5 字段加 exitCapture；可保留 V5 合法附加 JSON 元数据，但拒绝 zoneDraft/tradeId/opportunity/activeTrades/initialStop/currentInitialStop/currentManagement/currentManagementState/symbolCurrentManagement。所有数据必须能无损 JSON round-trip（plain对象、完整数组、无accessor/undefined/NaN/Infinity/负零/循环）。
- persisted：上述 workspace、cards、record 生命周期/快照/stages/researchCapture/exitCapture、migrationAudit。derived：activeOpportunity/activeTrades/effectiveDirection/lifecycle/effectiveInitialStop/currentManagement。不持久化 aggregate state 或缓存。
- `activeTradesForSymbol` 顺序 enteredAt ASC → registeredAt ASC → id ASC（直接字符串比较，非 locale 排序）。查询不修改状态，返回只读使用的 canonical record 引用；调用者不得直接写入。
- Validator 复用冻结 V5 validator 对单 record 的 detached compatibility view 进行事件/历史语义检查；视图仅临时验证，不落盘、不成为 V6 truth。额外校验 V6 集合、卡片白名单、时间连续/不倒退、exitCapture及flatten组一致性。
- 事件写入同样调用冻结 V5 手工事件函数处理 detached 单记录视图，取回事件数据写入 V6 目标。避免复制另一套事件解释器，不修改 V5、Step4数学引擎。
- 所有命令使用内部 candidate preflight：先验证输入 state，生成完整 detached candidate、一次revision变化并验证；仅成功后对调用方原对象执行确定性的内部变更。调用时固定time/targetIds/groupId；无用户 callback、storage、网络、随机数。原 record 对象/ID保持，未目标记录不修改。不可写对象在提交前拒绝，避免半修改。
- 模型函数保留常用接口名，但 record 操作接收 opportunityId；本轮不提供 symbol 单持仓兼容写API，防 M2 误关错误 Trade。

## Pure V5 → V6 Migration

- `migrateV5ToV6(v5State, {migratedAt})` 返回 `{state,migratedAt,audits}`，migratedAt显式安全非负整数；内部不读取当前时间，不写localStorage，不修改/覆盖输入原件。
- 首先调用现有 V5 assertState；invalid input抛 code=`INVALID_V5_STATE`、status=BLOCKED 的结构化错误。双副本不一致返回专门 `ACTIVE_RECORD_CONFLICT_IN_V5`，异常对象无candidate/state。
- 同 ID card snapshot与record一致时保留一份；缺失时从正式snapshot恢复原ID和字段，按固定 GC/CL/ES 顺序追加record，追加 `ACTIVE_RECORD_RECOVERED_FROM_V5_CARD` audit（from5/to6、symbol、opportunityId、migratedAt）。不猜原删除原因、不hidden。
- 正常迁移不增加通用summary audit。旧migrationAudit、sequence、revision、lastSavedAt、全部时间/事件/顺序原样保留，业务schema变为6。
- 未结束/未入场结束历史/rules_upgrade：exitCapture=null；旧 entered且reason=closed：UNKNOWN/null。不得猜Stop或Manual Flatten。
- card.opportunity移除；zoneDraft不进入records。非空或非字符串的draft可能包含用户内容，抛 `V5_ZONE_DRAFT_REQUIRES_REVIEW`，不产生candidate。空draft只作为临时UI字段忽略。
- V6严格时间/JSON/重复truth检查未通过时，返回 `V6_MIGRATION_CANDIDATE_INVALID`，不修复旧数据。M1不直接接受V3/V4，现有生产迁移链完全不变；调用方未来先经原链得到V5再调用此函数。

## Invariants / Verification

每ID唯一、每symbol≤1 pending、所有active同向且pending同向；ended永不active；card无交易对象；事件ID/来源/引用/顺序归属record；不可持久化有效值副本；快照不被背景API回写；单笔只改目标；批量全有或全无；active普通删除拒绝。

JSON stringify/parse + assertV6State后，records唯一恢复A+B active和C wait，不依赖card.opportunity或内存cache。非法操作、未确认、no-op均不增加revision。新测试覆盖用户A–U、独立单源审计、validator负例、migration确定性/冲突/恢复/legacy与production隔离；保留原655项，不改旧Ground Truth。

最终运行 npm test / npm run build / node --check dist/app.bundle.js / git diff --check；bundle必须与基线逐字节一致。只新增隔离模块/tests/docs并本地一次commit；不push/merge/deploy。不接UI/persistence生产入口，不实现执行重建、归属、matching、Store V2、Step5B或行情POC。
