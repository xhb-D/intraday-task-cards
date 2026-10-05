# Multi-Trade Architecture Audit V1

统一交易控制中心｜多笔独立交易架构专项审计

审计日期：2026-10-05。源码基线：`main` / `c4b97243cee5fd23bbea4ecb83a0568f22b25a78`。本报告为待人工审核的架构建议，**不是 Frozen Spec、实现授权或上线验收**。

## 1. Executive Summary

**推荐进入 V6 规范讨论，采用第三方案 B′：所有 Opportunity/Trade 都只保存在 `records[]`；cards 保存当前市场背景和无持仓时的方向选择；新机会与持仓列表均从 records 推导。** 相比原方案 B，把尚未入场的机会也放进唯一事实源，消除当前 card.opportunity 与 recordSnapshot 的双写。每品种最多一个未入场机会，可同时有 N 个同方向独立持仓。机会入场只是同一 ID 的生命周期变化，不搬家、不另建交易副本。

当前 V5/Step2/Step3 不符合新业务前提：V5 持仓时禁止登记 Setup；Step2 把 flat-to-flat 作为一笔 Logical Trade；Step3 按完整入场/退出窗口做一对一匹配。**必须改变这些边界，不能只解除 UI 禁用。** Step4A/B 的逐笔 1R、行情路径、政策与防前视计算可通过新 Research Trade adapter 大量复用。

真实样本结论：Entry Order↔Fill、成交 Stop Order↔Fill 可以直接按 Order ID 联结；Stop Order↔具体 Entry Order 的保护关系 **ORDER_LINKAGE_NOT_PROVEN**。Order Details 有同一 Stop 的修改/取消历史，没有明确 parent/root/bracket/OCO 字段。Position History 的买卖配对是 broker 报表事实，不能自动升级成用户独立 Setup 的 Stop 归属。

最大风险是**退出所有权证据缺失**，不是 R 公式。建议先接受“不能唯一证明就复核/阻断”的质量门槛，再冻结数据模型、退出操作和迁移例外政策。尚不能保证真实样本全自动归属。

### 1.1 范围、方法和证据等级

- Level 2 架构/复用审计；读取源码、冻结文档、测试、四份原始 CSV 与官方公开资料。未调用券商接口，未上传私人 CSV。
- 新业务前提由本轮用户指令提供；样本只验证字段与关系，不用于推导普遍交易习惯。
- `FACT`：文件/源码直接证明；`SUPPORTED_INFERENCE`：跨文件、条件明确的推导；`UNKNOWN`：缺少证明；`RECOMMENDATION`：待批准设计。
- 不做 scale-out、将多 Setup 合为 scale-in、Campaign/Portfolio R、reversal、hedging、实时行情、自动交易、broker order management、Step5B 或 Real Market Bundle POC。
- 仓库内仅新增本报告，未改生产代码、schema、migration、测试、bundle 或 CSS；未建开发分支，未 commit/push/merge/deploy。未使用子代理。

### 1.2 Level 2 Prior-Art / Reuse Audit

按“官方资料 → 成熟开源 → 参考实现”进行有界检索。三个主要实现候选为现有项目、Backtrader、LEAN；Tradovate 官方 API 是字段语义参考。未安装、克隆、Fork 或试跑外部实现。本审计考察的是离线浏览器内的数据捕获/研究，不是寻找新的交易平台。

先做 Hard Gate：Backtrader 是 Python 引擎，直接引入会跨越现有浏览器 JS/离线边界；GPL-3.0 与本仓库传播方式的兼容性未审核，因此不具备直接复用/Fork 资格。LEAN 需要 C#/平台运行环境，其完整引擎也不适合这一 MVP；Apache-2.0 不解决运行时与范围冲突。官方 API 需要认证且离线 CSV 缺少对应实体，不作为当前生产依赖。现有源码属于当前项目内部维护，未发现顶层 LICENSE；内部改造不引入外部授权，但对外代码复用许可不能据此推断。

| 八个审计维度 | 现有项目组件 | Backtrader | LEAN |
|---|---|---|---|
| Functional Fit | 单笔捕获/研究已验证；缺多笔生命周期与退出归属 | tradeid 可区分并存策略交易，bracket 有显式 parent；不能从本 CSV 补出归属 | OrderTicket/OrderEvent 生命周期有参考价值；未找到可直接满足本四表离线归属的组件 |
| Architecture Quality | 纯研究模块与 canonical/store 隔离清晰；model 活跃副本双写、执行窗口等同交易需改变 | 策略级 Trade 与 broker 层区分有参考价值；Python engine 不契合浏览器 | 事件与订单对象分离可参考；完整平台边界过大 |
| Maintenance Status | 当前基线已核对；本轮 655/655；维护归本项目 | 官方 repo/docs 可读；维护响应、最近 release/issue 解决速度未确认，不称活跃 | 官方 repo/docs 可读；未完成最近 release、issue/PR 响应审查，不以品牌认定维护质量 |
| License Compatibility | 无新增第三方代码；仓库公开复用许可未知 | GPL-3.0，直接复制/分发兼容性未证明；本轮仅概念参考 | Apache-2.0，有明确许可；若后续复制仍须核对通知与具体文件许可 |
| Testing Quality | 655 现有测试、合成样本及各冻结报告可查；新多笔能力尚无实现/测试 | repo 有 tests、MultiTrades/bracket 示例；本需求 Ground Truth 未验证 | repo 有 Tests/回测框架；当前 CSV 归属及浏览器集成未验证 |
| Dependency Quality | package 无新增运行依赖；现有 build/Node tests | 引入 Python/相关集成；未做供应链完整检查 | C#/完整平台及可选 Docker 工作流；依赖审计未完成 |
| Modification Cost | 状态/重建/匹配有较大改造；数学/replay保留 | 仍需自建 CSV、HTML、迁移、归属及 JS 接口；成本高 | 仍需自建本业务层并承担跨运行时集成；成本高 |
| Long-term Ownership Cost | 无新上游同步；主要成本为 migration、归属审计和回归 | Fork 同步加 Python↔JS 双体系，维护负担高 | 平台升级/运行环境加自定义研究语义，维护负担高 |

Backtrader 的 `tradeid` 是调用者赋给订单并由策略跟踪的标识，不是从券商历史里自动发现的所有权。[MultiTrades 官方说明](https://www.backtrader.com/blog/posts/2015-10-05-multitrades/multitrades/)。其 bracket 明确依赖父单/子单关系；缺失关系的 CSV 不会因使用框架而变完整。[Bracket 官方文档](https://www.backtrader.com/docu/order-creation-execution/bracket/bracket/)。许可/测试目录见 [Backtrader 仓库](https://github.com/mementum/backtrader)。

LEAN 的订单票据接口可参考订单与 fill 生命周期，不能证明本样本中 Stop 的用户 Trade 所有权。[Order Tickets 官方文档](https://www.quantconnect.com/docs/v2/writing-algorithms/trading-and-orders/order-management/order-tickets)。运行环境、Tests、许可见 [LEAN 仓库](https://github.com/QuantConnect/Lean)。

| 五维 Modification Delta | 现有组件改造 | Backtrader 整体接入 | LEAN 整体接入 |
|---|---|---|---|
| Business Logic | 高：多笔独立生命周期、独立退出归属 | 高：仍需实现用户业务与证据门槛 | 高：仍需实现用户业务与证据门槛 |
| Architecture | 中高：替换单活跃模型/执行窗口接口，保留纯计算 | 高：跨 Python 与浏览器 | 高：跨平台引擎与浏览器 |
| Integration | 中：现有 parser/research/UI adapters | 高：HTML、Unified、离线文件均自建 | 高：HTML、Unified、离线文件均自建 |
| Verification | 高：身份、数量守恒、迁移、退出 Ground Truth | 高且须额外验证外部引擎 | 高且须额外验证外部引擎 |
| Migration / Ownership | 中高：已有合法 V5 特例、V1 决策需兼容 | 高：现有数据迁移之外再维护 Fork | 高：现有数据迁移之外再维护平台 |

成本是相对范围判断，不是工期报价。现有组件复用可保留数学/路径/策略及其回归；全 Greenfield 要重证这些冻结语义。最强反证是现有状态、重建和匹配都要较大改动，不能把整体工作称为“小补丁”。外部实现并未消除 CSV 缺失证据，直接复用或 Fork 没有明显收益。

**推荐路径：`REUSE_COMPONENTS`，外部候选仅 `REFERENCE_ONLY`。** 整体适配/长期成本判断置信度 MEDIUM；当前单笔限制与样本缺字段判断 HIGH；真实 Stop 全自动归属可行性 LOW/不足证据。此推荐仍待 Chat/Human Decision Gate，不冻结架构。开放问题与决策项见第 16 节。

## 2. Current Single-Trade Assumptions

以下为基线源码事实，位置均以本次 HEAD 为准。

| 项目 | 代码位置 | 当前行为及影响 |
|---|---|---|
| 单一 card.opportunity | `src/model.js:35–40`、`:25` | 每 card 一个对象；stateOf 由这个对象返回 none/wait/signal/position，不能表达持仓 + 新 wait/signal |
| chooseSetup | `src/model.js:88–104`，关键 `:91` | position 直接 changed:false；同类型当前机会也拒绝；`card.opportunity` 与 `records.push(recordSnapshot())` 同时写入 |
| markEntered | `src/model.js:113–117` | 只转换唯一未入场 opportunity；已进入 position 无法第二次入场 |
| markExited | `src/model.js:127–132` | 只关闭该卡当前唯一 opportunity，无法选择 B 而保留 A |
| closeOpportunity | `src/model.js:54–63` | 已有先验校验 closeTime ≥ 最后 stage.start、全部 manualEvents.recordedAt；合法后才改 stage/endedAt/syncRecord/card。多笔版本必须保持且扩展批量原子性 |
| recordSnapshot / syncRecord | `src/model.js:33`、`:46` | 深拷贝活跃副本；syncRecord 只更新已有历史行，不补回已删记录 |
| assertState | `src/model.js:149–183` | activeMap 来自 cards；未结束 record 必须与卡片副本完全一致。不要求每个 card 活跃对象都有 record |
| 持仓 UI | `src/app.js:197–220` | direction/Setup 在 position 只读；单持仓摘要、单一“已平仓”按钮 |
| 指令文案 | `src/model.js:138–143` | “只管理当前持仓”“本卡不找新入场” |
| 退出确认 | `src/app.js:320–321` | “本笔已经实际全部平仓”与品种级全部平仓语义在单笔时一致，多笔时须拆分 |
| Research Capture 写入 | `src/model.js:339–379`；`src/app.js:166–195,297–303` | 写 API 通过 symbol 找唯一 card.opportunity；DOM stop ID 也用 symbol，不能安全用于多笔列表 |
| History | `src/app.js:229–237,380`；`src/model.js:135` | 每 record 一行，自然支持同 symbol 多行；普通删除目前也允许活跃 record |

V5 删除活跃 record 后，卡片仍持仓且后续修改不重新生成 record：`test/research-capture.test.js:270–275` 直接验证此行为。这是**合法旧状态**，不是可以忽略的损坏文件。

Step2 限制位于 `src/exit-research/logical-trade.js:23–43,74–88`：一个净仓位窗口输出一个 Logical Trade；多个 Entry/Exit Order 标 `UNSUPPORTED_SCALE_PATTERN`。Step3 限制位于 `reconciliation.js:16–41,46–73`：候选需要已关闭完整窗口，评分同时考虑 entry/exit 时间，one-to-one 使用 logicalTradeId。不能直接适配共享平仓。

## 3. Business Model

采用用户新前提：一次独立 Setup 入场就是一个独立 Trade，ID 沿用 opportunityId。A/B 同方向重叠是两笔研究交易，每笔拥有登记背景、HTML 入场/退出确认、实际 Entry、Initial Stop、1R、人工转换、Actual Holding 和 Replay；broker 合并净仓不合并研究身份。

三个边界必须分开：

1. **HTML Capture Truth**：用户登记了什么、何时确认入场/退出、逐笔手工 Stop/转换。HTML 时间不是真实 broker fill 时间。
2. **Execution Facts**：券商订单、成交、配对和净数量路径。独立于 HTML，不写回其 canonical records。
3. **Research Association**：哪个机会占用哪个 Entry、哪个退出事件分配多少数量、证据/人工确认/价格 convention/质量。不能由家庭品种名称或 net VWAP 混成交易事实。

同一品种活跃 Trade 同方向，不支持反手/对冲。单 Trade V1 一次 entry execution → 一次完整 exit event；同订单多个 partial fills 可聚合，不等于多个 Trade。实际遇到“同一 Trade 分次退出”“一个 entry order 分给多个独立 Setup”“一个 Setup 跨多个 entry orders”时，标识例外并复核/阻断，不能强行符合 V1。

Bias/Structure 是 card 当前描述背景；新机会登记时冻结自己的 snapshot，后续变化不得回改 A。Initial Stop 修正和 BOF→PB/撤销继续是该 Trade 的 append-only 事件，不是全品种共享管理状态。

## 4. Recommended V6 Data Model

### 4.1 A / B / B′ 比较与推荐

| 比较项 | A：card 内 activeOpportunity+activeTrades | B：card 新机会，records 已入场 | B′：records 保存所有生命周期（推荐） |
|---|---|---|---|
| 单一事实源/双写 | 若保留 history snapshots，N 个活跃副本都需双写 | 已入场消除双写；登记即有 history 时新机会仍双写 | 每 ID 一份；活跃/历史是查询视图 |
| Migration | card 持仓转数组，仍须去重/比对 history | entered/unentered 分流，搬家规则增加 | 合并 card 与 records 后一次分类；需处理缺失活跃 record |
| assertState | 校验两套集合及所有逐字段一致性 | 校验 card新机会与records入场集合、迁移交界 | 验证记录唯一、同向、未入场最多一个、时间/事件合法 |
| recordSnapshot/syncRecord | 扩为列表双写 | 保留新机会同步、入场移交 | 不作为 V6 双写接口；快照只用于导出/备份 |
| UI/history/capture | 遍历列表，事件写多个对象后同步 | 持仓遍历records，新机会另一路 | 查询 records；全部写操作按 opportunityId 找同一条 |
| Initial Stop/BOF→PB | 两份状态需一致 | 每笔 record 可复用，未入场部分单独处理 | reducer 按 record 原样工作；不持久化 effective/current 值 |
| Storage size | 活跃数据随 N 重复 | 仅新机会可能重复 | 每 ID 一份事件/阶段，最少重复 |
| Future compatibility | 新交易状态扩两层 | 新机会/Trade 交界要维护 | 同 ID 生命周期稳定，后续 adapter 无需对象搬迁 |
| Crash/reload | 双写半完成可能冲突 | 移交半完成可漏/重 Trade | 一个完整 workspace CAS 写入，reload 仅重算视图 |
| Schema clarity | card 和 history 都含“当前交易” | card/records 用 enteredAt 分工 | records 唯一，cards 只含当前背景/偏好 |

明确推荐**第三方案 B′**，而非把 A 的重复缓存加到 B 上。已有单笔数据只是迁移输入，不要求 V6 延续旧双写实现。

### 4.2 概念 JSON（示意，不是已实现 validator）

下面是 `sections.intraday.state` 的概念片段；使用数值时间，省略 CL/ES card 及与 V5 完全相同的其他字段。真实备份应保留完整原字段，而非按此片段删除字段。trade-A/B 已入场，op-C 未入场，全部在 records。`views` 是下一个代码块中的输出，**不进入 JSON 备份**。

```json
{
  "schemaVersion": 6,
  "sequence": 3,
  "revision": 8,
  "lastSavedAt": null,
  "cards": {
    "GC": {
      "symbol": "GC", "bias": "bullish", "structure3m": "range",
      "needsStructureReview": false, "direction": "long", "idleSince": 0
    }
  },
  "records": [
    {
      "id": "trade-A", "symbol": "GC", "direction": "long", "type": "mtf_pb",
      "createdAt": 1000, "registeredAt": 1000,
      "biasAtRegistration": "bullish", "structure3mAtRegistration": "bullish",
      "enteredAt": 2000, "endedAt": null, "reason": null,
      "attention": "wait", "stageSince": 2000,
      "stages": [{"state":"wait","start":1000,"end":2000},{"state":"position","start":2000,"end":null}],
      "researchCapture": {"eventSequence":1,"manualEvents":[
        {"id":"trade-A:manual-1","type":"INITIAL_STOP_RECORDED","recordedAt":2001,"effectiveAt":2001,"source":"manual_intraday","payload":{"stopPrice":3990}}
      ]},
      "exitCapture": null
    },
    {
      "id": "trade-B", "symbol": "GC", "direction": "long", "type": "htf_bof",
      "createdAt": 3000, "registeredAt": 3000,
      "biasAtRegistration": "bullish", "structure3mAtRegistration": "range",
      "enteredAt": 4000, "endedAt": null, "reason": null,
      "attention": "wait", "stageSince": 4000,
      "stages": [{"state":"wait","start":3000,"end":4000},{"state":"position","start":4000,"end":null}],
      "researchCapture": {"eventSequence":1,"manualEvents":[
        {"id":"trade-B:manual-1","type":"INITIAL_STOP_RECORDED","recordedAt":4001,"effectiveAt":4001,"source":"manual_intraday","payload":{"stopPrice":4025}}
      ]},
      "exitCapture": null
    },
    {
      "id":"op-C", "symbol":"GC", "direction":"long", "type":"mtf_pb",
      "createdAt":5000, "registeredAt":5000,
      "biasAtRegistration":"bullish", "structure3mAtRegistration":"range",
      "enteredAt":null, "endedAt":null, "reason":null,
      "attention":"wait", "stageSince":5000,
      "stages":[{"state":"wait","start":5000,"end":null}],
      "researchCapture":{"eventSequence":0,"manualEvents":[]},
      "exitCapture":null
    }
  ],
  "migrationAudit": []
}
```

```text
derived views for GC:
  activeOpportunity = records.find(symbol=GC && enteredAt=null && endedAt=null)  // op-C
  activeTrades = records.filter(symbol=GC && enteredAt!=null && endedAt=null)  // A,B
  effectiveDirection = activeTrades[0].direction                             // long
  currentManagement(A/B) = derivedManagementState(record)
  currentInitialStop(A/B) = effectiveInitialStop(record)
```

`records.id` 就是 opportunityId，不另存重复 tradeId。新 Research Trade 可用 versioned research identity 以 opportunityId 为锚；执行 association revision/fingerprint 独立，候选变更不使 HTML 身份变成另一笔。旧 researchTradeId 包含 logicalTradeId（`research-trade.js:31`），不得静默改读旧 ID。

Persisted：cards 当前背景/flat时方向偏好、records完整生命周期/注册快照/manualEvents、sequence/revision/migrationAudit、必要逐笔退出确认元数据。`exitCapture` 是待批准的最小扩展，建议只记录 `{kind: UNKNOWN|STOP_EXIT|MANUAL_FLATTEN|OTHER_EXIT, groupId}`；确认时间沿用 endedAt，避免第二份 timestamp。手动 flatten 的各目标 record 共享 groupId，不再持久化一套 activeTrade 数组或额外“已关闭集合”。旧 ended record 的 kind 用 UNKNOWN，不捏造 stop/manual 意图。

Derived：活跃集合、状态文本、有效 Initial Stop、当前 PB/BOF、broker net、Entry/Exit/VWAP、metrics、replay。UI 草稿若保留，只是非业务输入，不得成为交易 truth；zoneDraft 处理需在规范中定明。

绝不能双写：card.opportunity/card.activeTrades 与 records 的完整业务副本；initialStop/currentManagement 与事件 reducer 结果；HTML enteredAt/endedAt 与所谓“实际成交时间”；CSV/Bundle/计算结果进入 Unified。

Unified 外壳建议仍 V2，仅 Intraday section 升 V6；需要更新嵌套 validation/migration，而不是修改 Risk/Chime schema。Research Store 独立版本策略见第 8、11 节。

## 5. UI State Machine

不用一个 stateOf 枚举描述组合。建议 UI 输入为 `(activeTrades[], activeOpportunity)` 两个 derived 维度；单笔 stage 模型可保留，聚合状态不写进存储。

| 状态 | 当前持仓区 | 新交易机会区 | 允许动作 |
|---|---|---|---|
| 1 无仓/无机会 | 空 | 空 | 选方向/Setup |
| 2 无仓/wait或signal | 空 | 当前新机会 | 切stage、入场、取消/失效 |
| 3 A持仓 | A | 空 | 管理A、登记同向新机会 |
| 4 A+wait B | A | wait B | 管理A，等待/找信号/入场B |
| 5 A+signal B | A | signal B | 管理A、确认B入场 |
| 6 A+B持仓 | A、B | 空 | 各自管理、登记C |
| 7 A+B+Cwait/signal | A、B | C | C入场后持仓变3笔，新区清空 |
| 8 B Stop Exit | A | 保持原新机会 | 仅B ended；A的事件/stop/stage不变 |
| 9 A+C Manual Flatten | 空 | 未入场新机会保持原状 | A、C同批ended；未入场机会不算仓位 |

**明确推荐始终显示一个紧凑的新机会区**，空时直接选同向 Setup，不再额外加“新增同向机会”前置按钮。持仓区按笔显示 Setup、HTML入场确认时间、Initial Stop、当前管理与单笔退出按钮；不要把确认时间标成真实成交时间。三列卡片增长随真实持仓数，不扩展为交易控制平台。

Direction 推荐自动继承 activeTrades 的方向，同时只读显示；无持仓且无未入场机会时才用 card 的 direction 选择。持仓时当前 card direction 只是 flat偏好，不能覆盖 trade方向。退出最后一笔但尚有新机会时，新机会方向仍固定；待新机会结束才允许改向。更新 Bias/Structure 后新登记 C 取当时 snapshot，A/B 不变。

事件动作携带 opportunityId，不能仅 data-symbol；所有 stop editor/BOF→PB控件用 ID 避免重名。持仓参考纯派生 helper 可复用，但需逐笔输入；新版主状态不再显示“本卡不找新入场”。Initial Stop/当前管理的有效值必须来自每条 record。

退出建议采用**B为主、最小人工确认维护 Capture 活跃状态**：Actual Exit 在研究侧依据 Tradovate 后续归属；盘中不强制填订单ID或二级退出表单。提供 `[该笔已退出]`，一次针对明确ID的确认，可选止损/其他，未知允许UNKNOWN；品种 `[全部已平仓]` 一次确认关闭当时全部活跃ID。单笔动作是记录 broker 已发生结果，不发送交易命令。若完全不点单笔退出，HTML会保持待更新持仓，必须可见提示，不能靠下次CSV偷偷改写 canonical。是否接受这种操作负担是第16节决策项。

批量 flatten 捕获目标ID集合及预期 revision，先验证所有目标时间/合法性后一次提交；确认弹窗后新入场的 Trade 不应被旧确认误关。默认不取消新 wait/signal，若希望取消需单独冻结业务规则。

## 6. Tradovate Execution Model

### 6.1 原始样本收据与质量

源文件只读，位于 Downloads；本报告未复制 CSV。以下行号含表头（第1行），以 CSV 源行定位。账户名称/IP未抄入报告。

| 文件 | 行数（不含表头） | 字段数 | Bytes | SHA-256 |
|---|---:|---:|---:|---|
| Fills.csv | 16 | 25 | 3858 | `4786f1bbc4a6ec86f9d0e8a88e3561247cbaf01da21284821cf541f1009dbd59` |
| Orders.csv | 27 | 32 | 6251 | `4d9796b10b9a645a632f106e8336359aae8f0ee51e9f091de89570dab1cb9aaa` |
| Position History (1).csv | 10 | 26 | 2586 | `f069ef30e8466e53c52db3d5e8fe14042f3e5e457e662e8e090cd9e4ab893afe` |
| Order Details (1).csv | 43 | 6 | 3640 | `6bc82e2898eb95cf3f77e7e0b29fe85e72cbe16210b0cee9c69c81c4d4c712a2` |

核验脚本在仓库外：[check-sample.py](/private/tmp/multi-trade-audit-v1/check-sample.py)；脱敏派生证据：[sample-evidence.json](/private/tmp/multi-trade-audit-v1/sample-evidence.json)。脚本仅 read_bytes/open-read 原件，比较时 trim CSV 展示空格；不改源文件。再次运行可重建证据。

FACT：16个唯一Fill ID，12个有成交的Order ID，27个唯一订单，10个唯一Pair ID、4个Position ID。四文件无完全重复行；Details 43行只有34种id，是异质生命周期/状态行，不能当订单去重。Fills `_id/_orderId/_qty` 与展示别名一致。两行 raw price 存浮点表示差异（Fills行4、7），原parser能容忍极小差异并保留 provenance，不应用显示值覆盖raw。

联合核验：12/12成交订单都能由 Fills.Order ID→Orders.Order ID找到，成交数量/VWAP与Orders展示成交均价一致（容差1e-9）；10条Pair的20个两侧引用均存在，所有16条Fill累计配对数量等于各自Quantity。此为关系/数量检查，**不代表完整美元P/L对账、初始Flat证明或Setup所有权证明**。

Fills `_timestamp` 有Z，16条展示Timestamp均与raw整秒时间相差+8小时；Orders/History/Details显示时间无时区。+8是本样本观测一致性，不是通用导出时区规则。须保留配置/来源确认，不能将所有未来CSV默认为上海时间。

本轮没有新的人工Flat确认或真实HTML备份。实际运行当前 parser：Fills16、Orders27、History10行均通过；当前重建未确认Flat时返回 `WINDOW_START_FLAT_UNCONFIRMED`，0条正式交易。另做标明 `FOR_AUDIT_ONLY_NOT_CONFIRMED` 的假设Flat诊断，条件下有5个闭合窗口、0个开放窗口，MGC多单窗口被当前算法标unsupported。此诊断不是新执行Truth或真实匹配验收。

### 6.2 四类关系的证据分层

| 关系 | 直接事实 | 联合推导 | 尚不能证明 |
|---|---|---|---|
| Entry Order↔Fill | Fills有Order ID；Orders有同ID、B/S、数量、类型及成交信息 | Flat已确认且net方向建立/增加时，识别entry execution | 一个entry order就是一个用户独立Setup；具体opportunityId |
| Stop Order↔Fill | Orders行18的Buy Stop `627212253903` 对Fills行8；Orders行27的Sell Stop `627212254028` 对Fills行17 | 已知净路径时两者减少相应方向仓位 | Stop类型天然等于保护单；与某Entry的parent关系 |
| Stop Order↔Entry Order | 原文件无明确连接字段 | 时间/数量/价格或History配对可支持候选 | **ORDER_LINKAGE_NOT_PROVEN**；不能因最近入场/LIFO宣布唯一 |
| Order Details↔订单历史 | 首行id是Stop `627212253756`，末次modify id与Orders.lastCommandId/Version ID一致 | 同合约/数量、modify描述与状态形成该Stop历史链的强支持 | 每个Details.id的稳定实体类型、通用root链、任何Entry parent/bracket |

实际例子：Entry `627212253947` 在Fills行10–14拆为5条成交（2+1+1+1+1=6），VWAP7787.25；不能生成5笔独立Trade。History行6–10将这五条Buy Fill与一个Sell Fill `627212254009` 分别按2/1/1/1/1配对，说明退出Fill可承载多条数量分配，并非“一条Pair一笔Setup”。

History行6–11的Position ID均为 `627212253952`。在假设Flat净路径中，Buy6→Sell6闭合后，后来Buy2→Sell2另一个窗口仍用同Position ID。因此**Position ID在本样本不能作为flat-to-flat窗口的唯一身份**。Pair行4/5的Sell先于Buy，Buy/Sell字段是成交方向，不能直接按列名等同Entry/Exit。

MGC行6–9在假设Flat下为 `0→-2→-4→-2→0`：两张Sell entry、Buy Stop2、Buy Market2。History行4把Stop Buy Fill配给较早Sell Fill，行5把Market Buy配给较晚Sell Fill。这是broker配对事实，至少反驳“最后入场一定先退出”可以无条件套用；**仍不证明Stop保护哪个用户Setup**。Orders行16另有Sell Stop Rejected，不能归入已成交保护退出。Orders行27 Stop7779.75而实际Fill7779.25，止损触发价与成交价不能混用。

### 6.3 建议执行层对象

保留 raw/normalized fills 不变；新增概念边界而非Campaign：

| 对象 | 用途 | 身份/约束 |
|---|---|---|
| Execution Position Window | 已确认初始边界后，承载同账户+精确contract从Flat到Flat的净路径 | 与研究Trade不同；窗口ID由版本化来源锚生成，不用Position ID；open窗口保留未知结束 |
| Entry Execution | 一张实际入场订单的一组fills、qty/VWAP、first/completed时间 | account+contract+orderId+来源版本；fill归属唯一；同单partialfills先聚合 |
| Exit Execution Event | 实际减少净仓的订单/fills、qty/VWAP、类型与时间范围 | 可以分配给多Trade；类型Stop不自动代表所有权 |
| Attribution | opportunityId↔Entry、Trade↔Exit数量及证据 | 派生关联+必要人工决策，研究store独立；不是另一个HTML Trade对象 |

不能仅以orderId跨账户/合约混组；同单跨生命周期、reversal、乱序同秒影响净路径、重复/撤销fills等异常显式拒绝/复核。CSV无完整顺序信息时，sourceRow排序只能保证确定输出，不能证明真实成交先后。

`0→+1→+2→+1→0`：一个Window内两个EntryExecution E_A/E_B和两个ExitEvent X_1/X_2；先一对一匹配到HTML A/B，再独立归属退出。若X_1的Stop证据证明属于B，则B结束，X_2结束剩余A；没有证明则A/B ActualExit均不得擅自填好。窗口完整闭合只证明净数量回到0，不解决退出先后所有权。保留 REQUIRE_FLAT 和 KNOWN_INITIAL_POSITION API 空间，不静默取消Step2边界门槛。

## 7. Stop Attribution

### 7.1 真实 Order Details 的专项结论

完整字段仅：`id,timestamp,description,comments,clientApp,priority`。没有 `parentId/parentOrderId/rootId/rootOrderId/bracketId/strategyId/strategyRootId/ocoId/relatedOrderId/linkedOrder/masterOrderId/commandId/version/revision` 列。Orders含 `lastCommandId`、`Version ID`，`spreadDefinitionId` 全为空，不应按名字想象链接。

Details行2：Stop `627212253756` Sell5MESZ6，观察到最初价7737.25；行6/11/16/21/26/31/36七次 Modify to 的id依次762/766/770/774/778/803/807（均有前缀627212253），价格7741.5/7742.25/7745.75/7751.75/7758/7753.5/7751.5。Orders行3该Stop最终Canceled，lastCommandId=Version ID=`627212253807`，价7751.5。Details行41 Cancel id=`627212253830`，行44记录 Modify253807 ExecutionStopped。这说明最终snapshot的lastCommandId甚至没有指向随后Cancel id，不能认定它代表导出中最新一切事件。

**FACT**：上述行内容、ID相等、价格与状态；Details全文不提Entry `627212253748`。**SUPPORTED_INFERENCE**：它支持同一Stop修改生命周期关联。**UNKNOWN**：通用command/version导出契约、Entry parent、其他Stop的修改历史、导出之前是否还存在更早Stop版本。7737.25只能称“本文件观察到的首次Stop价格”，不能自动写为某Trade的Initial Stop。

官方 [Command List](https://partner.tradovate.com/api/rest-api-endpoints/orders/command-list) 中Command带orderId和New/Modify/Cancel；[Order Version List](https://partner.tradovate.com/api/rest-api-endpoints/orders/order-version-list) 中OrderVersion带orderId、orderQty和stopPrice。这些描述的是指向某订单的命令/版本，不能靠commandId相近或相等建立另一订单parent。**本样本commandId列缺失**，只能核对Details异质id与lastCommandId，不声明普遍“commandId仅代表修改”。

官方另有 [Order Strategy Link](https://partner.tradovate.com/api/rest-api-endpoints/orders/order-strategy-link-list) 的orderStrategyId/orderId/label。它与Command/Version是不同实体；本四份CSV未提供这些link，也没有实体角色完整链，文档存在接口不等于现有CSV已有证明。本轮未调用认证接口。OCO兄弟关联本身还需确认谁是Entry/Stop，不把任何共享strategy/OCO自动解释为保护parent。

**最终：ORDER_LINKAGE_NOT_PROVEN。** 当前Details不足以建立Stop→Entry→独立Trade明确关系。单Stop的修改历史样本也不能证明其他导出均完整或可用固定文本解析通用root。

### 7.2 建议证据优先级和门槛

| 等级 | 证据与必要条件 | 结果 |
|---|---|---|
| 明确关联 | 有可信来源的Entry/Stop实体链及角色；对应真实Entry Fill已唯一属于该Trade；account/contract/方向/qty/时间一致且无冲突 | 可自动归属，仍保留来源/验证明细 |
| 强推断 | Stop建立时间、entry时间、quantity、HTML stop、观察首次stop价/修改史、净减少量和存活Trade联合，仅一个合理候选但无parent | `ORDER_LINKAGE_NOT_PROVEN` + `REVIEW_REQUIRED`；允许人工确认归属，不能伪称broker证明 |
| 多候选 | 两笔相同qty/stop或时间接近，任一可解释 | `MATCH_AMBIGUOUS`；不设LIFO/FIFO默认，不自动结束任何HTML record |
| 冲突/不完整 | 无Fill、qty超过Trade余额、错账户/contract、Stop在entry前/时间基础未知、保护价与成交价混淆 | DATA_CONFLICT/BLOCKED或等待证据 |

Entry/Stop ID 是锚；没有共同的、语义已验证链接时，仅各自存在ID不构成关系。价格相同不是身份，Stop后来移价也不能改变原Initial Stop Truth。Rejected/Canceled单可提供上下文，不能变成实际Exit。不能把Position History的会计配对无条件当止损保护所有权；若与parent或用户确认冲突，保留冲突，不用某一种优先级消音。

## 8. Matching Model

建议把Entry Matching和Exit Attribution拆开。Entry Matching：entered HTML record ↔ Entry Execution，包含仍开放的Trade，不要求actual exit已知；利用researchFamily映射、方向、可信时间窗口、可能的账户/数量/entryID信息。HTML目前无执行账户与qty，不能假装已知，跨账户候选须歧义/人工选择。researchFamily保持GC/ES/CL，contextSymbol无显式值保持null，不伪造TradingView symbol。

当前global assignment的连通分量划分、唯一最优检测、人工confirm/reject、容量限制/超限转歧义、非词典序强行破同分的原则可复用（`reconciliation.js:46–73,119–145`）。但候选对象、describe/评分、闭合要求、exit时间阈值、executionQa按LT索引都必须改。Entry不得靠“最后哪个exit更近”抢配，也不能把手工退出顺序反推已确定Entry。

必须同时验证 EntryExecution 一对一与**实际Fill集合互斥**：两个execution对象若包含同一fill，即使ID不同也不能占给两笔Trade。人工决定不能绕过此约束。一个entry order多人Setup或多order一Setup超出V1正常规则，须提示，不能重复计qty。

`manual-matches.js:4–17,22–28` 的fingerprint覆盖整个旧LogicalTrade（Entry+Exit等）；`ui/store.js:9–17`严格白名单。不能给V1 decision替换logicalTradeId值为EntryID却继续认定有效。建议研究关联独立新版本/namespace，旧V1原样保留，旧LT决定只用于旧模式；人工再确认迁移后entry关系。未来Exit确认用单独类型、fingerprint和allocatedQty，允许共享但限制容量。保留opportunity级preferences/settings，过期执行指纹不自动复活。Store版本/独立key需在规范冻结时决策，不写Unified，不保存原CSV/Bundle。

## 9. Exit Attribution

### 9.1 归属与数据恢复

Entry保持一对一；Exit是有容量的多对一分配。目标记录集合与数量必须显式，不把现有reconciliation的“reserved logicalTradeId不能被再用”规则套到共享Exit。

STOP EXIT：已证明/已人工确认Stop所有权后，ExitQty必须等于目标Trade剩余qty（V1完整退出），只归给B；A的entry、stage、事件和余额保持不变。若只成交B的一部分，保留raw事实，标 `PARTIAL_TRADE_EXIT_UNSUPPORTED`，不把B标完整结束、不把剩余量推给A。

MANUAL FLATTEN：先验证同scope最后净仓回0，并确认它是用户手动flatten事件而非仅凭Market类型认定。归给当时尚存活的A/C，qty总和等于ExitEvent qty，可共享exitEventId；此前已Stop结束的B不得重复占用。一个Fill被共享是**数量分片引用**，不能每笔都占整张Fill全部qty。全局sum(allocatedQty by fill) ≤ FillQty，完整事件要求等号；分配后每笔余额非负。

HTML `[全部已平仓]` 关闭的是用户确认当时该品种捕获中的全部持仓ID；研究实际flatten按**账户+精确执行合约**核验。单个contract的券商Sell不能证明另一账户/另一期合约已平。若HTML一个GC范围可能混MGC/GC、多账户、多contract，当前捕获没有字段可区分，必须在规范中限制工作范围或增加显式绑定决策，不能将研究family当broker scope。

Actual Exit后续导入只生成研究关联；不能自动结束canonical HTML。HTML漏点退出/有冲突时独立显示“捕获状态待确认”，需要用户明确修正才能写canonical。记录late capture、时间来源与真实Fill时间分开；如何开放历史修正是后续需冻结的规则，不把本轮设计自动扩展为全面历史编辑。

### 9.2 Exit Price / 不同qty / 多Fill

推荐手动flatten没有明确逐Trade fill ownership时，全部目标共用该事件真实成交的**数量加权VWAP**，实际退出完成时间取事件最后Fill，另保留开始/完成时间及fill provenance。假设A qty1、C qty2，Sell1@4010+Sell2@4011，事件VWAP=4010.666…；分配A1/C2，价格都用该VWAP。每笔1R仍用自己的entry/stop；P/L aggregate按qty加总守恒，R不能简单相加代替账户P/L。

该价格是 `SHARED_FLATTEN_VWAP` **研究定价约定**，不是broker逐Trade lot真实售价。可以确定事件全部fills/VWAP，但不能据此称逐Trade fill所有权精确。须在质量/provenance区分“实际事件成交已证”与“归属/定价约定已确认”；在该约定被人工批准前不进入正式自动统计。

如果有明确、完整且一致的逐Trade fill分配证据，可采用各Trade实际分配fills的VWAP；仅“数量刚好可分”“Pair显示某FIFO会计配对”“价格接近stop”不足以选择哪张Fill属于A，默认不按FIFO/LIFO硬分。多Fill只有部分覆盖、跨日/缺失或总qty与剩余数不符则不正式计算Realized R。

Actual Holding计算必须有明确逐笔结束窗口。退出归属未知时，当前metrics质量应BLOCKED，不能填broker窗口最终结束当两笔共同ActualExit。若以后要独立展示“截至某显式时间的路径”需另设接口/口径，本轮不借此改变Step4A。

## 10. Research Engine Reuse

每笔仍“一次Entry VWAP + 原始Initial Stop + 一次完整Exit”时，1R=`abs(entry-stop)` 原样成立；LONG/SHORT方向及止损有效性检查保留。A entry4000/stop3990→10点；B entry4030/stop4025→5点，完全独立。不需Campaign R作为V1必备概念。

下表“原样复用”指为新adapter提供满足冻结输入契约的完整单Trade时，不修改该模块算法；不是把旧窗口均价/时间直接喂入新交易。

| 文件/能力 | 分类 | 条件和处理 |
|---|---|---|
| `r-math.js`：1R/Realized R/thresholdPrice | 原样复用 | 每Trade真实entry与有效stop，quantity不混入每单位R |
| `path-metrics.js`：Actual Holding MFE/MAE | 原样复用 | 各自actualEntry/actualExit，price source及coverage保留 |
| `milestones.js`：2/4/6/8/10R | 原样复用 | 各自1R/窗口，保持confirmed/possible/incomplete |
| `market-metrics.js` | 小改接口即可（优先adapter） | 新ResearchTrade保留现输入字段；质量加Entry/Exit归属依据，不能改READY门槛来掩盖缺失 |
| `path-metrics.js` 5M boundary与1M detail | 原样复用 | 重叠bar/边界不把全bar极值归入窗口，不因多笔持仓改变时间语义 |
| `market-data.js` / `market-config.js` | 暂不需要修改 | Bundle验证/角色/指纹不依赖HTML单持仓；同series可供多个Trade只读查询 |
| `market-request.js` / `replay-request.js` | 小改接口即可（请求adapter） | 每Trade请求可合并传输区间但各自保留使用窗口；Actual Holding和ReplayHardEnd分离 |
| `replay-engine.js` Policy Replay | 原样复用计算内核 | 独立entry/stop/events、预定HardEnd、符合qualityStatus；不共享A/B的运行状态 |
| `policies-v1.js` PB/BOF；`policy-schema.js` | 暂不需要修改/原样复用 | 不改冻结数值/阶段；每TradeoriginalSetup独立 |
| model reducers + replay manual transitions | reducer原样复用，写入/adapter小改 | 每record事件，原setup不覆盖；撤销保留历史、不回写另Trade |
| `protection.js` | 原样复用 | 每run独立protection，单调不放宽；execution tick明确 |
| `execution-model.js` stopFill | 原样复用 | 是OHLC模拟stop规则，不是实际券商Stop ownership解算器 |
| `replay-data.js` Hard End/边界 | 原样复用 | 显式预配置HardEnd，不用ActualExit悄悄替代政策终点 |
| `replay-trace.js` | 原样复用 | 每run因果sequence，不把多Trade trace串成一个policy状态 |
| `lookahead-qa.js` / `replay-quality.js` | 原样复用现审计内核 | 仍传对应bundle核验；质量上游适配不伪造READY |
| `research-trade.js` | 必须重构 | entry来源改EntryExecution、exit来自Attribution、独立ID/指纹/质量，不用Window VWAP |
| `execution-qa.js` | 必须重构接口/集合边界 | 原order总量核对方法可保留；Pair不能要求“同一研究Trade拥有整个Exit Fill”，改全局qty分配核验 |

当前 `market-metrics.js:37–39` 需要actualExitTime/Price；`replay-engine.js:59–62` 遵守上游quality门槛，BLOCKED不会运行正式replay。不能声称“退出未知时Step4照样直接可出正式结论”。想分别评价entry quality与exit quality是未来规范决策，V1保守adapter先保持阻断。

Step5A**不是只换matching输入就全部不动**：详情/Replay卡/中文label/Trace折叠/过滤模式基本复用；`ui/view-model.js:12–14`只取closedTrades、`:38`计数，`controller.js`candidate决定、`render.js:35`候选退出展示、导出gate和V1 store严格结构均依赖LogicalTrade。需更新Entry与退出归属的提示/候选/质量/技术细节，不增加订单控制UI。CSV/Bundle仍只在内存，Research Store只放决定/偏好/设置，Risk与Chime不可写。

## 11. Migration V5→V6

本轮未实现/运行V6 migration；以下是建议安全规则，**真实V5备份未在本轮提供，不能称已完成真实迁移验收**。

1. 读取/验证原始V5；先保留逐字节原始备份及hash、快照回读验证，失败不写canonical。复用Unified现有CAS、pre-upgrade snapshot及rollback模式（`unified-persistence.js:148–175`），但不能只保留单个可被随后导入覆盖的槽，需确保冻结迁移原件可持续恢复。
2. 在临时candidate合并card当前对象与records，按原ID对齐。两份一致则保留一份record；不一致不选“较新”或last-write-wins，报conflict人工审查；原V5验证链仍先执行。
3. enteredAt=null、endedAt=null→derived activeOpportunity；enteredAt!=null且endedAt=null→activeTrade；endedAt!=null→历史。未入场的canceled/invalid/direction结束记录继续历史，不误变持仓。
4. 保留id、sequence、全部manualEvents及顺序/事件ID、旧stop修正引用、BOF→PB及撤销、type/direction/context快照、所有原时间戳、zone/reasons/audits。仅schema布局变更，不能猜actual fill、补假stop、重新编ID或用Date.now改交易事实。
5. **合法V5特例：card活跃但record已删除。** 不能只迁移records导致持仓/事件消失；也不能无声复活用户删除过的历史。建议报告 `ACTIVE_RECORD_MISSING_IN_V5`，从card保留完整active候选与原ID，迁移Audit记录来源。是否恢复history行/保留hidden marker/需人工预览确认必须先批准。未冻结政策前不能宣称migration对所有合法V5可自动无损完成。absence本身也不能证明是用户删除，不自动发明删除原因。
6. 未来V6禁止普通删除未结束记录；结束记录删除或隐藏须保留既有导出说明并判断研究decisions是否变stale。建议hide/history visibility代替删除活跃对象，但其字段是否加入schema由Human Gate决定。
7. deterministic：给定相同raw、固定版本与已冻结例外policy生成同candidate；ID/时间/顺序不随机。审计元数据使用固定来源savedAt或由外层传入固定migrationAt，不影响交易事实。重复迁移/重载幂等。
8. Unified V2 RiskManager/Chime/preferences逐字段保持；V3→V4→V5原链保留，再V5→V6，不重写已有taxonomy迁移。旧独立备份的统一导入限制仍按原规范，不能悄悄新增恢复入口。
9. validate完整V6candidate后CAS一次写入，readback验证；quota/conflict/readback失败保持旧raw、revision与内存业务state。批量关闭/事件写同样candidate先验再原子提交。
10. 研究决定兼容单独处理：V1旧LT指纹原样保存，不迁移成Entry人工确认；opportunityId仍能保持preferences/HardEnd/tick settings指向原Trade，执行事实变化使决定过期。版本化新decision结构要有导入预览/回退，不覆盖旧Store；原CSV/Bundle不加入任何存储。

reload恢复证明（设计推演）：持久化records中的A/B具有enteredAt且endedAt=null，C具有enteredAt=null/endedAt=null/attention=wait；纯谓词唯一恢复`[A,B]`与C。没有必须从内存恢复的activeTrades数组，也没有card与history谁优先的问题。该设计论证不是已完成浏览器crash测试；未来验证见J及扩展矩阵。

History现表map(records)天然可多行，同GC显示PB/BOF各行；需更新删除规则、逐ID动作与管理列/导出，而非另建持仓历史表。

## 12. Invariants

1. opportunityId全局唯一；每个未结束机会和Trade都在records中，cards无第二份业务对象。
2. 每symbol最多一个未入场未结束Opportunity；N个活跃Trade同方向；新机会方向继承活跃集合。
3. direction/type/registeredAt/登记Bias与Structure一旦形成对应业务事实，后续市场更新不得改旧记录；originalSetup不被BOF→PB覆盖。
4. enteredAt!=null且endedAt=null才是Capture activeTrade；ended不active；未入场不持仓；同ID最多一次入场。
5. 生命周期/阶段时间连续、不倒退；closeTime≥最后stage.start和最大manualEvent.recordedAt；非法单笔/批量动作state deepEqual调用前、revision不变。
6. 批量flatten先验所有目标，全部成功或零修改；CAS确认目标集合/版本，防关闭新增Trade；未入场机会不被flatten自动结束。
7. 单笔Stop capture只关闭指定ID；Actual Stop Attribution也只消耗该Trade余额，不分摊给其他Trade。
8. manualEvents append-only、ID/sequence/引用合法，按record归属；effective stop/currentManagement只有一个reducer truth；修正/撤销保留首次事件。
9. 普通删除禁止未结束记录；异常恢复有显式来源审计，不能丢活跃事件。
10. reload只由持久化records重算；CSV/Bundle、research关联不改canonical/Risk/Chime。
11. 起点Flat必须显式确认；KNOWN_INITIAL_POSITION未实现不得偷偷用0；文件结束open不强制close。
12. Execution按account+精确contract划scope，family/context symbol不替代contract；时间基础unknown不制造UTC。
13. Fill ID/EntryExecution唯一，Entry Match全局一对一且fill集合互斥，人工confirm同样遵守。
14. Exit可共享但allocQty守恒；sum by fill≤原qty，完整事件等号；每Trade不超余额，不重复关闭Stop已结束Trade。
15. Stop linkage明确事实/强推断/未知分开；OCO/command/version相等不自动证明parent；LIFO/FIFO不破歧义。
16. 真实partialTradeExit、跨零reversal、未覆盖事件、数量冲突都阻断正式逐笔退出；不可自动平均掉异常。
17. Entry VWAP是本Trade entry，不是Broker净仓均价；StopFill actual price不是trigger price；共享flattenVWAP显式标convention。
18. 每Trade1R独立；metrics窗口逐笔actual Entry→Exit；replay HardEnd预先显式、每run独立、禁止未来信息。
19. 手工决策ID/fingerprint版本化、证据变化过期；旧LT确认不自动变新Entry确认。
20. 迁移保存原件，保留旧ID/events/times；所有损失/冲突显式报告，未批准例外不自动完成写入。

## 13. Test Matrix

**下表是未来必须实现的验证，不是本轮新增测试/通过结果。** 本轮仅运行已有测试：655/655 PASS、0 fail、0 skip。日志：[npm-test.log](/private/tmp/multi-trade-audit-v1/npm-test.log)。

| 场景 | 输入/动作 | 必须验证 |
|---|---|---|
| A | 无持仓→PB入场 | 同ID从新机会变active，无重复record |
| B | A持仓→新PB等待 | A不变、Bwait快照新背景 |
| C | A持仓→B入场 | A/B两条active，新区清空 |
| D | A+B→B Stop Exit | B ended，A state/events完整不变 |
| E | 上一步reload/继续管理A | A仍active，B历史，不能重新匹配占用B退出 |
| F | A持仓→C入场 | A+Cactive，方向继承 |
| G | A+C→Manual Flatten | 相同退出组、两者同时结束、一次revision提交 |
| H | A/B不同InitialStop、修正A | R不同，Bstop不变，首次记录保留 |
| I | A BOF→PB、B仍BOF/撤销A | per-record管理正确，originalSetup不变 |
| J | A+B+Cwait刷新/关闭浏览器重开 | 单一persisted records恢复3种业务状态；CSV/Bundle不残留 |
| K | V5唯一active position迁移 | 原ID/时间/事件全保留、一个activeTrade |
| L | V5wait/signal迁移 | 一个activeOpportunity、零activeTrades |
| M | 0→1→2→1→0 | 一个Window两个entry、两个exit；不以unsupported替代新需求；无link不能自动填退出 |
| N | Sell2同时结束两Trade | Exit共享，allocatedQty1+1=2，不能各占2 |
| O | Stop qty/价格相同多个候选 | MATCH_AMBIGUOUS；不LIFO，不写回任何record |
| P | Entry一对一，重叠fill人工确认 | solver/人工都拒绝同Fill双占 |

扩展必测：

- 同订单5个partial fills聚为一个entry；多个entry orders不能自动等同独立Setup数量；同ID跨scope拒绝；重复/撤销/乱序/同秒fill冲突。
- singleStop先退出A（不是后入场B）、同Stop多modify、Canceled/Rejected不作fill；无Details/缺parent、只有command关联、OCO只有兄弟角色未知，全部保留证据等级。
- Price不等stop、slippage、gap；止损qty不等目标余额，真实partial blocking；无HTML qty/账户候选歧义。
- flatten A1/C2，多fill不同价格共享VWAP及qty加总守恒；明确证据individual分配；只覆盖部分/超量/double-allocation拒绝。
- 仍有新wait/signal时最后持仓退出，方向锁不错误解除；flatten不取消未入场机会；popup后新增Trade不误关。
- 单笔/批量时间早于最后stage或任何manual event→state/revision/deepEqual不变；批量中第二目标非法不得先关闭第一个；确认取消无修改。
- V5全部ended/none、legacy V3/V4链、历史被删但卡仍active、冲突双副本、缺ID非法输入、空capture/补记/修正/多次转换撤销；迁移确定/幂等/JSON round-trip。
- quota/备份失败/readback失败/CAS跨标签冲突/crash中断保持旧raw；原件hash一致；禁止ordinary删除active。
- V1 Research Store导入、新旧decision指纹隔离、旧确认不自动迁移、settings按opportunityId保留；export不带CSV/Bundle。
- Step4逐笔adapter与原单笔golden完全一致、同Bundle重叠窗口分别MFE/MAE/milestones、5M/1M边界/gaps/proxy/tick/HardEnd/Lookahead全回归；未归属退出不能READY。
- GC/CL/ES隔离、History多行、id控件唯一、手机/桌面dark/light；Unified V2 Risk/Chime原数据和所有现有兼容矩阵不变。

## 14. Module Impact Matrix

| 模块/阶段 | 当前假设 | 新需求 | 修改程度 | 说明 |
|---|---|---|---|---|
| Step1 `model.js` | 一个card.opportunity+history副本 | records canonical多active+1pending | Major | 生命周期/查询/断言/关闭/删除/事件目标ID；纯reducer复用 |
| Step1 `app.js` | position禁止Setup、单持仓/单exit | 列表+同向新区+单笔/全部退出 | Major | per-ID DOM/actions/确认；不改Risk/Chime功能 |
| Step1 `persistence.js` | Intraday5、单笔Markdown | V6嵌套校验/迁移/多行 | Medium/Major | JSON/Markdown字段和delete语义；原时间/事件保留 |
| Unified persistence/startup | V3/4/5校验、Unified2 | 接入V6 migration+原件保障 | Medium | 外壳2、风险/报时结构不变；CAS/rollback模式保留 |
| Holding Reference | card唯一持仓 | 每record辅助管理 | Low | 纯数值不改，调用/布局适配 |
| Step2 CSV/time parser | 原始字段/时间/alias | 不改既有三表口径 | None | 可复用；Order Details无当前专用parser，未来若授权需单独适配 |
| Step2 logical-trade | flat-to-flat=Trade | Window+Entry/ExitExecution | Major | 边界确认保留，ID版本化、异常分类、qty路径 |
| Step3 execution-qa | 每LT含完整所有fills/pairs | scope全局facts+allocation | Major | order totals算法复用；会计pairs不直接当用户Trade归属 |
| Step3 reconciliation | closed Opportunity↔LT | Opportunity↔EntryExecution | Major | solver思想复用，输入/评分/gate/容量改 |
| 新 Exit Attribution | 无独立共享模型 | Stop单笔、flatten多笔数量容量 | New bounded module | 缺证据拒绝/复核；不自动控制订单、不扩campaign |
| Step3 manual-matches/store | LT-ID+whole-window fingerprint V1 | Entry/Exit版本化决策 | Medium/Major | append/CAS思路保留；兼容导入不能静默替换 |
| Step3 research-trade | LT entry/exit均价+identity | 每独立Trade执行归属adapter | Major | 独立entry/stop/exit/来源/质量 |
| Step4A r/math/path/milestones | 单entry/stop/exit输入 | 每Trade仍相同输入 | None内核 / Low adapter | 不新增CampaignR；缺退出阻断 |
| Step4A Bundle/request | 每Trade窗口 | 多Trade共享只读series | None/Low | 不改source/boundary/fingerprint语义 |
| Step4B replay/policy/trace/lookahead | 单Trade独立run | 每Trade独立run | None内核 / Low adapter | policies数值不动；保持事件/HardEnd/防前视 |
| Step5A view-model/controller | closedLT、旧candidate/store | entry及exit分别质量/操作 | Medium/Major | 不仅替换数组；Store版本/计数/导出gate同步 |
| Step5A render/labels/export | 每Trade详情/trace/replay | 同型结果+归属解释 | Low/Medium | 展示组件大量复用；技术详情加证据/convention |
| `test/*`/fixtures/QA scripts | 单笔冻结契约 | 多笔+迁移+allocation Ground Truth | Major additive | 原655项保留回归，旧V5契约测试版本化而非删掉 |
| build/bundle | 现有模块集 | 经未来授权接入新模块 | Low integration | 本轮不build、不改bundle；未来所有检查必做 |
| Risk Manager / Chime / Pages | 独立section/部署 | 无新业务要求 | None | 不重构、不改schema，不借审计上线 |

## 15. Recommended Implementation Order

这是**Human Gate之后的条件性验证顺序**，不是正式Implementation Plan，也不授权开始任何阶段。

1. **G0 先裁决**：B′、最小退出捕获、history删除迁移、账户/contract scope、shared VWAP口径、歧义阻断；完成Business Spec，再完成Architecture Spec，明确Verification标准及隔离基线。
2. **M1 V6最小model + migration设计一并验证**：records单源、per-ID动作、same-direction、批量原子性、删除边界；先用合法旧状态fixture证明迁移可恢复，避免UI先跑起来后才发现数据无法落地。
3. **M2 持仓列表/新机会Capture + persistence**：UI与JSON/Markdown采用同一model；一次完成迁移candidate、原件保障、reload/CAS验证，冻结这层独立验收基线。
4. **M3 Execution Window/Entry/Exit facts +全局QA**：保留Flat门槛；先证同单partialfill与0→1→2→1→0、scope/qty/time，不先写matching猜身份。
5. **M4 Entry Matching +版本化manual decisions**：复用solver原则，完成一对一/fill互斥；再独立实现Exit Attribution与共享容量守恒，二者各自质量，不用exit抢entry。
6. **M5 ResearchTrade adapter +Step5A接口适配**：先用已证明/人工确认归属的逐笔对象对原Step4A/B golden逐值回归，再接列表、候选、质量、Store导出兼容。
7. **M6 全回归/失效恢复/人工UI验收**：原冻结tests、扩展矩阵、desktop/mobile、隔离与真实V5副本迁移；不改生产原件，不直接deploy。
8. **G1 另行批准真实数据归属POC/上线**：若用户后来授权，再用更多边界样本+相应HTML记录核验所有权与操作负担。此真实执行归属POC不包含Real Market Bundle POC或Step5B，本轮均不启动。

## 16. Risks / Open Questions

| 风险/未知 | 影响 | 审计建议与待决策 |
|---|---|---|
| **Stop→Entry保护关系未证** | 不能保证真实逐Trade ActualExit自动正确；会污染1R之外的全部退出指标 | 接受REVIEW_REQUIRED/MATCH_AMBIGUOUS及人工归属；后续更多完整链接样本需另行授权，不从单例造规则 |
| V5活跃历史可删除 | B′纯records迁移漏仓；盲目补行违背旧“不复活”行为 | 必须批准recover active + audit/hidden/人工预览政策，现阶段不自动迁移 |
| HTML缺account/contract/qty | 相同family多scope时entry/flatten不唯一 | 冻结V1仅一个明确scope，或研究绑定明确决策；不得family替代精确contract |
| 完全后置退出重建 vs盘中活跃状态 | 未点退出的B仍显示持仓，方向/新机会背景可能混淆 | 推荐后置ActualExit+最小ID确认；是否接受单笔一次确认需用户决定 |
| broker Pair与用户保护意图冲突 | FIFO会计配对可能与独立Stop研究语义不同 | 原Pair保留为原事实，保护归属单独记录证据；冲突不能消音 |
| sharedflattenVWAP | 事件价精确不等于各lot真实价 | 用户批准统一研究定价convention，并明确显示provenance；不冒称broker精确分配 |
| Research Store V1身份/指纹 | 错复用旧确认导致虚假MATCHED | 新namespace/版本不reinterpret，保留旧raw；导入迁移需单独规格 |
| 初始边界/导出完整性/timezone | 非Flat或丢fill会改变entry/exit角色，Details仅一张Stop | REQUIRE_FLAT保持、known-position未实现显式阻断；样本+8不当全局默认 |
| 数学内核复用的前提 | 模型输入错误时655旧测试不能证明新多笔正确 | 用新逐笔adapter和多笔Ground Truth验证，不改内核来迎合错误归属 |

**必须先问用户/Chat决策的事项（本轮以报告列出，停止等待，不开展依赖工作）：**

1. 是否批准 B′（全部records单源）以及普通删除未结束记录禁用？V5卡片有持仓而history被删时，允许恢复活跃record并如何显示原删除意图？
2. 是否接受单笔退出仅一次ID确认、原因可UNKNOWN；ActualExit后置Tradovate重建且不自动写canonical？还是要求另一种盘中Capture恢复流程？
3. V1是否限定每HTML品种只有一个执行账户/明确合约scope？如跨账户/跨合约如何绑定，不能静默继承当前单样本关系。
4. 无明确Fill所有权时是否批准共享flattenVWAP作为研究口径，且接受其非broker逐lottruth标识？
5. 是否接受缺Stop linkage时正式逐笔metrics/replay可被阻断，先人工确认归属；未来缺字段需要何种低负担证据，而非每笔强制导出Details？
6. flatten时尚未入场的新机会默认保留是否符合业务？Research Store新旧决策版本共存/人工再确认政策是否接受？

验证边界：本轮跑了现有655项测试与只读sample checks；没有新增V6代码/测试，因此没有V6浏览器行为、真实V6迁移、真实HTML↔CSV匹配或新归属引擎验收。未运行build以避免改dist；原bundle保持未修改。结束时再次核对原四CSVhash、HEAD与tracked diff。

## 17. Final Answers Q1–Q5

**Q1：V6最小推荐数据模型是什么？**

B′：workspace.cards只存当前背景/flat方向偏好，records唯一存每个Opportunity完整生命周期，entered/ended谓词派生activeTrades和唯一新机会。每record保留自己的事件、stop与originalSetup；active列表/有效管理不持久化。退出最小kind/groupId字段与迁移删除特例待规范批准，Unified保持V2、研究Store继续独立。

**Q2：持仓中如何登记新的独立Trade而不使HTML复杂？**

持仓列表加始终可见的紧凑新机会区，方向自动继承且只读，直接选Setup→wait/signal→入场；同ID成为新active Trade，新区清空。无需额外“新增”前置按钮，每笔stop/BOF操作通过ID定位。

**Q3：单笔Stop Exit与Manual Flatten分别如何记录？**

Capture单笔只确认目标ID，全部平仓一次原子关闭当时活跃ID集合；HTML确认时间/原因不冒充broker成交。研究Stop必须证明/人工确认归属，qty全量结束目标；flatten可共享ExitEvent按各Trade剩余qty分配，容量守恒，无证明则复核/阻断。默认不关未入场新机会。共享VWAP是需批准并标明的研究定价约定。

**Q4：0→+1→+2→+1→0如何拆成独立Research Trades？**

执行层一个Window、两个EntryExecution及两次ExitEvent；两个entry与HTML A/B一对一匹配，退出再独立归属。证明第一Stop属于B则B先结束、A继续；缺失证明不能用LIFO或平均分仓填ActualExit，保留歧义。本真实样本 **ORDER_LINKAGE_NOT_PROVEN**，Order Details仅支持某Stop生命周期，不能保证自动完成此拆分。

**Q5：Step1–5A哪些必须改，哪些可直接复用？**

必须改Step1状态/捕获UI/嵌套迁移与导出、Step2重建对象、Step3候选/全局QA/退出归属/研究adapter/决策版本、Step5A依赖旧LT的view-model/controller/candidate/store/gates。直接复用现三表parser/time规则、按record的stop与management reducers、Step4的1R/路径/MFE/MAE/milestones/Bundle/policies/protection/模拟stop/HardEnd/Trace/lookahead计算内核以及Step5A详情与Replay展示组件；保留冻结契约通过adapter接入。Risk/Chime/Pages无业务修改需求。

AUDIT COMPLETE.

NO IMPLEMENTATION AUTHORIZED.

RETURN TO CHAT/HUMAN DECISION GATE.
